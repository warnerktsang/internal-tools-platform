/**
 * The operations layer, exercised through a miniature refund resource. The resource is a
 * test fixture on purpose: it proves an app can declare a state machine, a guard, an
 * approval policy and an effect without the substrate knowing anything about refunds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/substrate/db';
import { enableAuditBypass } from '@/substrate/audit/bypass';
import { verifyAuditChain } from '@/substrate/audit';
import { decide } from '@/substrate/approvals';
import { registerPort, resetPorts, runEffects } from '@/substrate/effects';
import { execute } from '@/substrate/operations';
import { defineResource } from '@/substrate/resource';
import { invalid, type PortOutcome } from '@/substrate/types';
import { principal, resetDatabase, seedPrincipal } from '@/test/db';

type RefundRow = {
  id: string;
  paymentId: string;
  businessUnitId: string;
  amountMinor: number;
  state: string;
  requesterId: string;
};

const refundResource = defineResource<RefundRow>({
  name: 'refund',
  table: 'refunds',
  label: 'Refund',
  delegate: (tx) => tx.refund,
  scope: { dimension: 'business_unit', field: 'businessUnitId' },
  fields: {},
  machine: {
    initial: 'draft',
    states: ['draft', 'submitted', 'succeeded', 'failed', 'unknown'],
    transitions: [
      {
        action: 'submit',
        from: ['draft'],
        to: 'submitted',
        permission: 'refund:request',
        requiresApproval: 'threshold',
        // App-specific correctness, running inside the transaction on the locked row.
        guard: async ({ record, tx }) => {
          const payment = await tx.payment.findUniqueOrThrow({
            where: { id: record.paymentId },
          });
          const settled = await tx.refund.aggregate({
            where: { paymentId: record.paymentId, state: { in: ['submitted', 'succeeded'] } },
            _sum: { amountMinor: true },
          });
          const already = settled._sum.amountMinor ?? 0;
          if (already + record.amountMinor > payment.capturedMinor) {
            invalid('refund would exceed the captured amount', 'amountMinor');
          }
        },
        effect: ({ record }) => ({
          port: 'processor',
          operation: 'refund',
          payload: { refundId: record.id, amountMinor: record.amountMinor },
          idempotencyKey: `refund:${record.id}`,
        }),
      },
      {
        action: 'settle',
        from: ['submitted'],
        to: 'succeeded',
        permission: 'refund:settle',
      },
      {
        action: 'park_unknown',
        from: ['submitted'],
        to: 'unknown',
        permission: 'refund:settle',
        apply: () => ({ unknownSince: new Date() }),
      },
    ],
  },
  approvals: {
    threshold: {
      name: 'threshold',
      rules: [{ appliesWhen: (r) => Number(r.amountMinor) > 10_000, approvers: 1, eligibleRoles: ['finance_manager'] }],
      exclusions: { excludeRequester: true },
    },
  },
});

const sam = principal({
  id: 'sam',
  displayName: 'Sam Okafor',
  roles: ['support_agent'],
  scopes: { business_unit: ['us'] },
});
const mo = principal({
  id: 'mo',
  displayName: 'Mo Haddad',
  roles: ['finance_manager'],
  scopes: { business_unit: ['us'] },
});
const raj = principal({
  id: 'raj',
  displayName: 'Raj Patel',
  roles: ['support_agent'],
  scopes: { business_unit: ['eu'] },
});
const fin2 = principal({
  id: 'fin2',
  displayName: 'Lena Voss',
  roles: ['finance_manager'],
  scopes: { business_unit: ['us'] },
});
const worker = principal({
  id: 'system.processor',
  kind: 'system',
  email: null,
  displayName: 'Processor effect worker',
  roles: ['system_effects'],
  scopes: {},
});

async function seedRefund(overrides: Partial<RefundRow> & { id: string }): Promise<RefundRow> {
  const row = {
    businessUnitId: 'us',
    amountMinor: 5_000,
    state: 'draft',
    requesterId: 'sam',
    ...overrides,
  };
  await db.$transaction(async (tx) => {
    await enableAuditBypass(tx);
    await tx.payment.upsert({
      where: { id: 'pay-1' },
      create: {
        id: 'pay-1',
        reference: 'PAY-1',
        businessUnitId: 'us',
        customerName: 'Nadia Silva',
        capturedMinor: 20_000,
        processorRef: 'ch_1',
        capturedAt: new Date(),
      },
      update: {},
    });
    await tx.refund.create({
      data: {
        id: row.id,
        reference: `RF-${row.id}`,
        paymentId: 'pay-1',
        businessUnitId: row.businessUnitId,
        amountMinor: row.amountMinor,
        state: row.state,
        reason: 'duplicate charge',
        requesterId: row.requesterId,
      },
    });
  });
  return { ...row, paymentId: 'pay-1' };
}

beforeEach(async () => {
  await resetDatabase();
  resetPorts();
  await Promise.all([sam, mo, raj, fin2, worker].map(seedPrincipal));
});

describe('execute', () => {
  it('applies a valid transition, writing state and audit in one transaction', async () => {
    await seedRefund({ id: 'r1' });

    const result = await execute({
      resource: refundResource,
      action: 'submit',
      recordId: 'r1',
      principal: sam,
    });

    expect(result).toEqual({ status: 'ok', data: { id: 'r1', state: 'submitted' } });
    const [refund, audit] = await Promise.all([
      db.refund.findUniqueOrThrow({ where: { id: 'r1' } }),
      db.auditEvent.findFirstOrThrow({ where: { resource: 'refund', kind: 'write' } }),
    ]);
    expect(refund.state).toBe('submitted');
    expect(audit.action).toBe('submit');
    expect(audit.before).toMatchObject({ state: 'draft' });
    expect(audit.after).toMatchObject({ state: 'submitted' });
    await expect(verifyAuditChain()).resolves.toMatchObject({ ok: true });
  });

  it('rejects an action that does not apply to the current state', async () => {
    await seedRefund({ id: 'r1', state: 'succeeded' });

    const result = await execute({
      resource: refundResource,
      action: 'submit',
      recordId: 'r1',
      principal: sam,
    });

    expect(result.status).toBe('invalid');
    expect(result.status === 'invalid' && result.field).toBe('state');
  });

  it('returns invalid and rolls back when a domain guard fails', async () => {
    await seedRefund({ id: 'r1', amountMinor: 8_000, state: 'succeeded' });
    await seedRefund({ id: 'r2', amountMinor: 8_000, state: 'succeeded' });
    await seedRefund({ id: 'r3', amountMinor: 8_000 });

    const result = await execute({
      resource: refundResource,
      action: 'submit',
      recordId: 'r3',
      principal: sam,
    });

    expect(result).toMatchObject({ status: 'invalid', field: 'amountMinor' });
    const refund = await db.refund.findUniqueOrThrow({ where: { id: 'r3' } });
    expect(refund.state).toBe('draft');
    expect(await db.auditEvent.count({ where: { recordId: 'r3' } })).toBe(0);
  });

  it('denies an out-of-scope actor and records the attempt', async () => {
    await seedRefund({ id: 'r1' });

    const result = await execute({
      resource: refundResource,
      action: 'submit',
      recordId: 'r1',
      principal: raj,
    });

    expect(result).toMatchObject({ status: 'denied', rule: 'scope' });
    const denial = await db.auditEvent.findFirstOrThrow({ where: { kind: 'auth_denied' } });
    expect(denial.actorId).toBe('raj');
    expect(await db.refund.findUniqueOrThrow({ where: { id: 'r1' } })).toMatchObject({
      state: 'draft',
    });
  });

  it('parks an operation that needs approval, leaving state untouched', async () => {
    await seedRefund({ id: 'r1', amountMinor: 15_000 });

    const result = await execute({
      resource: refundResource,
      action: 'submit',
      recordId: 'r1',
      principal: sam,
    });

    expect(result).toMatchObject({ status: 'pending', policy: 'threshold', requiredApprovers: 1 });
    expect(await db.refund.findUniqueOrThrow({ where: { id: 'r1' } })).toMatchObject({
      state: 'draft',
    });
    const request = await db.approvalRequest.findFirstOrThrow();
    expect(request).toMatchObject({ state: 'pending', requesterId: 'sam', action: 'submit' });
  });

  it('does not park an operation below the declared threshold', async () => {
    await seedRefund({ id: 'r1', amountMinor: 9_999 });

    const result = await execute({
      resource: refundResource,
      action: 'submit',
      recordId: 'r1',
      principal: sam,
    });

    expect(result.status).toBe('ok');
    expect(await db.approvalRequest.count()).toBe(0);
  });

  it('returns the stored outcome for a replayed idempotency key without acting twice', async () => {
    await seedRefund({ id: 'r1' });
    const input = {
      resource: refundResource,
      action: 'submit' as const,
      recordId: 'r1',
      principal: sam,
      idempotencyKey: 'submit:r1',
    };

    const first = await execute(input);
    const second = await execute(input);

    expect(first).toEqual(second);
    expect(await db.auditEvent.count({ where: { kind: 'write', recordId: 'r1' } })).toBe(1);
    expect(await db.effect.count()).toBe(1);
  });

  it('enqueues the declared effect in the same transaction as the write', async () => {
    await seedRefund({ id: 'r1' });

    await execute({ resource: refundResource, action: 'submit', recordId: 'r1', principal: sam });

    const effect = await db.effect.findFirstOrThrow();
    expect(effect).toMatchObject({
      port: 'processor',
      operation: 'refund',
      state: 'queued',
      idempotencyKey: 'refund:r1',
      recordId: 'r1',
    });
    const write = await db.auditEvent.findFirstOrThrow({ where: { kind: 'write' } });
    expect(effect.requestId).toBe(write.requestId);
  });
});

describe('approvals', () => {
  async function park(amountMinor = 15_000): Promise<string> {
    await seedRefund({ id: 'r1', amountMinor });
    const result = await execute({
      resource: refundResource,
      action: 'submit',
      recordId: 'r1',
      principal: sam,
    });
    if (result.status !== 'pending') throw new Error(`expected pending, got ${result.status}`);
    return result.approvalRequestId;
  }

  it('refuses the requester as approver', async () => {
    const approvalRequestId = await park();

    const result = await decide({
      resource: refundResource,
      approvalRequestId,
      approver: sam,
      decision: 'approved',
    });

    expect(result).toMatchObject({ status: 'denied', rule: 'separation_of_duties' });
    expect(await db.approval.count()).toBe(0);
  });

  it('refuses an approver without an eligible role', async () => {
    const approvalRequestId = await park();

    const result = await decide({
      resource: refundResource,
      approvalRequestId,
      approver: raj,
      decision: 'approved',
    });

    expect(result).toMatchObject({ status: 'denied', rule: 'eligible_roles' });
  });

  it('applies the reviewed payload when the final approval lands', async () => {
    const approvalRequestId = await park();

    const result = await decide({
      resource: refundResource,
      approvalRequestId,
      approver: mo,
      decision: 'approved',
      note: 'verified with the customer',
    });

    expect(result).toMatchObject({ status: 'applied', result: { status: 'ok' } });
    expect(await db.refund.findUniqueOrThrow({ where: { id: 'r1' } })).toMatchObject({
      state: 'submitted',
    });
    expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequestId } })).toMatchObject(
      { state: 'approved' },
    );
    // The write is attributed to the requester; the decision to the approver.
    const write = await db.auditEvent.findFirstOrThrow({ where: { kind: 'write' } });
    expect(write.actorId).toBe('sam');
    expect(write.reason).toBe(`approved:${approvalRequestId}`);
    const decision = await db.auditEvent.findFirstOrThrow({
      where: { kind: 'decision', action: 'submit:approved' },
    });
    expect(decision.actorId).toBe('mo');
  });

  it('counts one approver once', async () => {
    const approvalRequestId = await park();
    await decide({ resource: refundResource, approvalRequestId, approver: mo, decision: 'approved' });

    const again = await decide({
      resource: refundResource,
      approvalRequestId,
      approver: mo,
      decision: 'approved',
    });

    expect(again.status).toBe('invalid');
    expect(await db.approval.count()).toBe(1);
  });

  it('marks the request stale when the guard fails at replay', async () => {
    const approvalRequestId = await park();
    // The baseline moves while the request sits in the queue.
    await seedRefund({ id: 'other', amountMinor: 19_000, state: 'succeeded' });

    const result = await decide({
      resource: refundResource,
      approvalRequestId,
      approver: mo,
      decision: 'approved',
    });

    expect(result).toMatchObject({ status: 'applied', result: { status: 'invalid' } });
    expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequestId } })).toMatchObject(
      { state: 'stale' },
    );
    expect(await db.refund.findUniqueOrThrow({ where: { id: 'r1' } })).toMatchObject({
      state: 'draft',
    });
  });

  it('applies once when two approvers decide at the same time', async () => {
    const approvalRequestId = await park();

    const results = await Promise.all([
      decide({ resource: refundResource, approvalRequestId, approver: mo, decision: 'approved' }),
      decide({ resource: refundResource, approvalRequestId, approver: fin2, decision: 'approved' }),
    ]);

    expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { kind: 'write', action: 'submit' } })).toBe(1);
    expect(await db.effect.count()).toBe(1);
  });

  it('records a rejection without applying anything', async () => {
    const approvalRequestId = await park();

    const result = await decide({
      resource: refundResource,
      approvalRequestId,
      approver: mo,
      decision: 'rejected',
      note: 'not our error',
    });

    expect(result).toEqual({ status: 'rejected' });
    expect(await db.refund.findUniqueOrThrow({ where: { id: 'r1' } })).toMatchObject({
      state: 'draft',
    });
  });
});

describe('effect worker', () => {
  function processorPort(outcomes: PortOutcome[]) {
    const execute_ = vi.fn(
      async (_payload: Record<string, unknown>, _idempotencyKey: string): Promise<PortOutcome> =>
        outcomes.shift() ?? { status: 'succeeded' },
    );
    registerPort({
      name: 'processor',
      systemPrincipalId: 'system.processor',
      operations: {
        refund: {
          execute: execute_,
          settle: async ({ outcome, effect, principal: actor }) => {
            await execute({
              resource: refundResource,
              action: outcome.status === 'succeeded' ? 'settle' : 'park_unknown',
              recordId: effect.recordId,
              principal: actor,
              idempotencyKey: `settle:${effect.idempotencyKey}`,
            });
          },
        },
      },
    });
    return execute_;
  }

  async function submitted(): Promise<void> {
    await seedRefund({ id: 'r1' });
    await execute({ resource: refundResource, action: 'submit', recordId: 'r1', principal: sam });
  }

  it('executes a queued effect and lets the outcome re-enter as a system operation', async () => {
    processorPort([{ status: 'succeeded' }]);
    await submitted();

    const results = await runEffects();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ outcome: 'succeeded', retrying: false });
    expect(await db.refund.findUniqueOrThrow({ where: { id: 'r1' } })).toMatchObject({
      state: 'succeeded',
    });
    const settle = await db.auditEvent.findFirstOrThrow({ where: { action: 'settle' } });
    expect(settle.actorId).toBe('system.processor');
    await expect(verifyAuditChain()).resolves.toMatchObject({ ok: true });
  });

  it('reports an undetermined outcome as unknown rather than failed', async () => {
    processorPort([{ status: 'unknown', error: 'gateway timeout' }]);
    await submitted();

    const [result] = await runEffects();

    expect(result.operation).toMatchObject({ status: 'unknown', reason: 'gateway timeout' });
    expect(await db.effect.findFirstOrThrow()).toMatchObject({ state: 'unknown' });
    const refund = await db.refund.findUniqueOrThrow({ where: { id: 'r1' } });
    expect(refund.state).toBe('unknown');
    expect(refund.unknownSince).not.toBeNull();
  });

  it('treats a thrown error as unknown, because the call may have landed', async () => {
    registerPort({
      name: 'processor',
      systemPrincipalId: 'system.processor',
      operations: {
        refund: {
          execute: async () => {
            throw new Error('socket hang up');
          },
        },
      },
    });
    await submitted();

    const [result] = await runEffects();

    expect(result.outcome).toBe('unknown');
  });

  it('keeps the effect retryable when domain settlement fails', async () => {
    registerPort({
      name: 'processor',
      systemPrincipalId: 'system.processor',
      operations: {
        refund: {
          execute: async () => ({ status: 'succeeded' }),
          settle: async () => {
            throw new Error('database unavailable');
          },
        },
      },
    });
    await submitted();

    const [result] = await runEffects();

    expect(result).toMatchObject({ outcome: 'succeeded', retrying: true });
    expect(await db.effect.findFirstOrThrow()).toMatchObject({
      state: 'queued',
      lastError: 'database unavailable',
    });
  });

  it('retries a failure with backoff, then gives up', async () => {
    const port = processorPort([
      { status: 'failed', error: 'declined' },
      { status: 'failed', error: 'declined' },
      { status: 'failed', error: 'declined' },
      { status: 'failed', error: 'declined' },
    ]);
    await submitted();
    await db.effect.updateMany({ data: { maxAttempts: 2 } });

    const first = await runEffects();
    expect(first[0]).toMatchObject({ retrying: true });
    expect(await db.effect.findFirstOrThrow()).toMatchObject({ state: 'queued', attempts: 1 });

    await db.effect.updateMany({ data: { nextAttemptAt: new Date() } });
    const second = await runEffects();

    expect(second[0]).toMatchObject({ retrying: false, outcome: 'failed' });
    expect(port).toHaveBeenCalledTimes(2);
    expect(await db.effect.findFirstOrThrow()).toMatchObject({ state: 'failed', attempts: 2 });
  });

  it('passes a stable idempotency key so a retry cannot double-apply', async () => {
    const port = processorPort([{ status: 'failed', error: 'timeout' }, { status: 'succeeded' }]);
    await submitted();

    await runEffects();
    await db.effect.updateMany({ data: { nextAttemptAt: new Date() } });
    await runEffects();

    expect(port.mock.calls.map((call) => call[1])).toEqual(['refund:r1', 'refund:r1']);
  });

  it('deduplicates a re-enqueued intent on its idempotency key', async () => {
    processorPort([]);
    await submitted();

    await db.$transaction(async (tx) => {
      await enableAuditBypass(tx);
      await tx.refund.update({ where: { id: 'r1' }, data: { state: 'draft' } });
    });
    await execute({ resource: refundResource, action: 'submit', recordId: 'r1', principal: sam });

    expect(await db.effect.count()).toBe(1);
  });
});
