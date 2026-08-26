/**
 * The refunds app against a real Postgres and the real (hostile) fake processor.
 *
 * These tests are about domain correctness — money, thresholds, undetermined outcomes and
 * unreliable delivery. The substrate's mechanics are tested in the substrate; here we care
 * that the declarations add up to a refund tool that cannot overpay.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { decide } from '@/substrate/approvals';
import { verifyAuditChain } from '@/substrate/audit';
import { enableAuditBypass } from '@/substrate/audit/bypass';
import { db } from '@/substrate/db';
import { registerPort, resetPorts, runEffects } from '@/substrate/effects';
import { execute } from '@/substrate/operations';
import { create } from '@/substrate/operations/create';
import { principal, resetDatabase, seedPrincipal } from '@/test/db';
import { parseAmountToMinor } from '@/apps/refunds/money';
import {
  processorCallCount,
  processorPort,
  queueOutcomes,
  receiveWebhook,
  resetProcessor,
} from '@/apps/refunds/processor';
import { refundResource } from '@/apps/refunds/resource';

const agent = principal({
  id: 'usr-agent',
  roles: ['support_agent'],
  scopes: { business_unit: ['bu-consumer'] },
});
const otherAgent = principal({
  id: 'usr-agent-smb',
  roles: ['support_agent'],
  scopes: { business_unit: ['bu-smb'] },
});
const manager = principal({
  id: 'usr-manager',
  roles: ['finance_manager'],
  scopes: { business_unit: ['bu-consumer'] },
});
const settler = principal({
  id: 'sys-refund-settler',
  kind: 'system',
  roles: ['system_effects'],
});

const PAYMENT_ID = 'pay-1';

async function seedPayment(capturedMinor = 50_000, businessUnitId = 'bu-consumer'): Promise<void> {
  await db.$transaction(async (tx) => {
    await enableAuditBypass(tx);
    await tx.payment.create({
      data: {
        id: PAYMENT_ID,
        reference: `PAY-${capturedMinor}`,
        businessUnitId,
        customerName: 'Test Customer',
        capturedMinor,
        processorRef: 'ch_1',
        capturedAt: new Date(),
      },
    });
  });
}

async function draft(
  amountMinor: number,
  as = agent,
  overrides: Record<string, unknown> = {},
): Promise<ReturnType<typeof create>> {
  return create({
    resource: refundResource,
    principal: as,
    data: {
      reference: `RF-${amountMinor}-${Math.random().toString(36).slice(2, 8)}`,
      paymentId: PAYMENT_ID,
      businessUnitId: 'bu-consumer',
      amountMinor,
      currency: 'USD',
      reason: 'test',
      requesterId: as.id,
      ...overrides,
    },
  });
}

async function draftAndSubmit(amountMinor: number, as = agent) {
  const created = await draft(amountMinor, as);
  if (created.status !== 'ok') throw new Error(`draft failed: ${JSON.stringify(created)}`);
  const submitted = await execute({
    resource: refundResource,
    action: 'submit',
    recordId: created.data.id,
    principal: as,
  });
  return { id: created.data.id, submitted };
}

beforeEach(async () => {
  await resetDatabase();
  resetPorts();
  resetProcessor();
  registerPort(processorPort);
  for (const p of [agent, otherAgent, manager, settler]) await seedPrincipal(p);
  await seedPayment();
});

describe('money', () => {
  it('parses only amounts it can represent exactly in minor units', () => {
    expect(parseAmountToMinor('19.99')).toEqual({ ok: true, minor: 1_999 });
    expect(parseAmountToMinor('$1,200')).toEqual({ ok: true, minor: 120_000 });
    expect(parseAmountToMinor('0.05')).toEqual({ ok: true, minor: 5 });
    expect(parseAmountToMinor('19.999').ok).toBe(false);
    expect(parseAmountToMinor('-5').ok).toBe(false);
    expect(parseAmountToMinor('abc').ok).toBe(false);
    expect(parseAmountToMinor('0').ok).toBe(false);
  });
});

describe('creating a refund', () => {
  it('refuses an amount above what was captured', async () => {
    const result = await draft(60_000);
    expect(result.status).toBe('invalid');
    expect(await db.refund.count()).toBe(0);
  });

  it('refuses a currency that does not match the payment', async () => {
    const result = await draft(1_000, agent, { currency: 'EUR' });
    expect(result.status).toBe('invalid');
  });

  it('denies a request into another business unit before anything is written', async () => {
    const result = await draft(1_000, otherAgent);
    expect(result.status).toBe('denied');
    expect(await db.refund.count()).toBe(0);
    // The attempt itself is evidence.
    const denial = await db.auditEvent.findFirst({ where: { kind: 'auth_denied' } });
    expect(denial?.actorId).toBe(otherAgent.id);
  });

  it('writes the record and its audit row together', async () => {
    const result = await draft(1_000);
    expect(result.status).toBe('ok');
    const events = await db.auditEvent.findMany({ where: { resource: 'refund' } });
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('create');
  });

  it('holds the cumulative invariant across separate refunds on one payment', async () => {
    const first = await draftAndSubmit(30_000);
    if (first.submitted.status !== 'pending') throw new Error('expected pending');
    await decide({
      resource: refundResource,
      approvalRequestId: first.submitted.approvalRequestId,
      approver: manager,
      decision: 'approved',
    });

    // 30k is in flight; 25k more would exceed the 50k captured.
    const second = await draft(25_000);
    expect(second.status).toBe('invalid');
    expect((second as { reason: string }).reason).toContain('already refunded or in flight');
  });

  it('counts an undetermined refund against the payment, so it cannot be paid twice', async () => {
    const { id } = await draftAndSubmit(9_013);
    await runEffects();
    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('unknown');

    // 9,013 may or may not have been paid, so only 40,987 of the 50,000 remains available.
    const second = await draft(41_000);
    expect(second.status).toBe('invalid');
  });
});

describe('approval threshold', () => {
  it('submits without approval below the threshold', async () => {
    const { id, submitted } = await draftAndSubmit(9_900);
    expect(submitted.status).toBe('ok');
    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('submitted');
  });

  it('parks above the threshold and does not call the processor', async () => {
    const { id, submitted } = await draftAndSubmit(15_000);
    expect(submitted.status).toBe('pending');
    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('draft');
    expect(await db.effect.count()).toBe(0);
  });

  it('refuses the requester as their own approver', async () => {
    const { submitted } = await draftAndSubmit(15_000, manager);
    if (submitted.status !== 'pending') throw new Error('expected pending');

    const outcome = await decide({
      resource: refundResource,
      approvalRequestId: submitted.approvalRequestId,
      approver: manager,
      decision: 'approved',
    });
    expect(outcome.status).toBe('denied');
  });

  it('applies the parked refund when a finance manager approves it', async () => {
    const { id, submitted } = await draftAndSubmit(15_000);
    if (submitted.status !== 'pending') throw new Error('expected pending');

    const outcome = await decide({
      resource: refundResource,
      approvalRequestId: submitted.approvalRequestId,
      approver: manager,
      decision: 'approved',
    });
    expect(outcome.status).toBe('applied');

    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('submitted');
    expect(await db.effect.count()).toBe(1);
  });

  it('re-checks the invariant when an approval applies later', async () => {
    // Two requests, each valid alone, jointly over the captured amount. The first is
    // approved and submitted; the second must fail when its approval finally lands.
    const first = await draftAndSubmit(30_000);
    const second = await draftAndSubmit(30_000);
    if (second.submitted.status !== 'pending') throw new Error('expected pending');
    expect(first.submitted.status).toBe('pending');
    if (first.submitted.status !== 'pending') throw new Error('expected pending');

    await decide({
      resource: refundResource,
      approvalRequestId: first.submitted.approvalRequestId,
      approver: manager,
      decision: 'approved',
    });

    const outcome = await decide({
      resource: refundResource,
      approvalRequestId: second.submitted.approvalRequestId,
      approver: manager,
      decision: 'approved',
    });
    // The approval was valid; the operation it released no longer is.
    if (outcome.status !== 'applied') throw new Error(`expected applied, got ${outcome.status}`);
    expect(outcome.result.status).toBe('invalid');

    const stale = await db.refund.findUniqueOrThrow({ where: { id: second.id } });
    expect(stale.state).toBe('draft');
  });
});

describe('the processor', () => {
  it('settles a successful refund under the system principal', async () => {
    const { id } = await draftAndSubmit(2_500);
    await runEffects();

    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('succeeded');
    expect(refund.processorRef).toBeTruthy();

    const settlement = await db.auditEvent.findFirst({
      where: { recordId: id, action: 'settle' },
    });
    expect(settlement?.actorId).toBe('sys-refund-settler');
  });

  it('records a decline as failed, not as undetermined', async () => {
    const { id } = await draftAndSubmit(2_507);
    await runEffects();
    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('failed');
  });

  it('retries a transient failure instead of reporting it as declined', async () => {
    const { id } = await draftAndSubmit(2_500);
    queueOutcomes({ status: 'failed', error: 'processor_unavailable' });

    const [result] = await runEffects();
    expect(result.retrying).toBe(true);
    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('submitted');
  });

  it('leaves a timed-out refund undetermined, with the moment recorded', async () => {
    const { id } = await draftAndSubmit(2_513);
    await runEffects();
    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('unknown');
    expect(refund.unknownSince).toBeInstanceOf(Date);
  });

  it('does not pay twice when the worker retries', async () => {
    const { id } = await draftAndSubmit(2_500);
    queueOutcomes({ status: 'unknown', error: 'connection reset' });

    await runEffects();
    // Retry the same effect: the processor sees the same idempotency key.
    await db.effect.updateMany({ where: { recordId: id }, data: { state: 'queued', nextAttemptAt: new Date() } });
    await runEffects();

    expect(await processorCallCount()).toBe(1);
    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('unknown');
  });

  it('reconciles an undetermined refund against what the processor actually did', async () => {
    const { id } = await draftAndSubmit(2_513);
    await runEffects();
    expect((await db.refund.findUniqueOrThrow({ where: { id } })).state).toBe('unknown');

    const reconcile = await execute({
      resource: refundResource,
      action: 'reconcile',
      recordId: id,
      principal: manager,
    });
    expect(reconcile.status).toBe('ok');
    await runEffects();

    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('succeeded');
    expect(refund.processorRef).toBeTruthy();
  });

  it('does not let a support agent reconcile', async () => {
    const { id } = await draftAndSubmit(2_513);
    await runEffects();
    const result = await execute({
      resource: refundResource,
      action: 'reconcile',
      recordId: id,
      principal: agent,
    });
    expect(result.status).toBe('denied');
  });
});

describe('webhooks', () => {
  it('applies a settlement event once and ignores its redelivery', async () => {
    const { id } = await draftAndSubmit(2_500);

    expect(
      await receiveWebhook({
        externalId: 'evt_1',
        type: 'refund.succeeded',
        refundId: id,
        processorRef: 'pi_1',
      }),
    ).toBe('applied');
    expect(
      await receiveWebhook({
        externalId: 'evt_1',
        type: 'refund.succeeded',
        refundId: id,
        processorRef: 'pi_1',
      }),
    ).toBe('duplicate');

    const writes = await db.auditEvent.findMany({ where: { recordId: id, action: 'settle' } });
    expect(writes).toHaveLength(1);
    expect(await db.processorEvent.count({ where: { type: 'refund.succeeded' } })).toBe(1);
  });

  it('converges on a stale event instead of overwriting a terminal state', async () => {
    const { id } = await draftAndSubmit(2_500);
    await receiveWebhook({ externalId: 'evt_ok', type: 'refund.succeeded', refundId: id });

    // A 'failed' event for the same refund arrives late, out of order.
    expect(
      await receiveWebhook({ externalId: 'evt_late', type: 'refund.failed', refundId: id }),
    ).toBe('out_of_order_converged');

    const refund = await db.refund.findUniqueOrThrow({ where: { id } });
    expect(refund.state).toBe('succeeded');
  });

  it('keeps an event for a refund it does not have', async () => {
    expect(
      await receiveWebhook({ externalId: 'evt_x', type: 'refund.succeeded', refundId: 'missing' }),
    ).toBe('unmatched');
    const row = await db.processorEvent.findUniqueOrThrow({ where: { externalId: 'evt_x' } });
    expect(row.disposition).toBe('unmatched');
  });
});

describe('audit', () => {
  it('keeps the chain verifiable across the whole refund lifecycle', async () => {
    const { id, submitted } = await draftAndSubmit(15_000);
    if (submitted.status !== 'pending') throw new Error('expected pending');
    await decide({
      resource: refundResource,
      approvalRequestId: submitted.approvalRequestId,
      approver: manager,
      decision: 'approved',
    });
    await runEffects();
    await receiveWebhook({ externalId: 'evt_final', type: 'refund.succeeded', refundId: id });

    const verification = await verifyAuditChain();
    expect(verification.ok).toBe(true);
  });
});
