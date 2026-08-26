/**
 * The operation gateway: the single path by which domain state changes.
 *
 * Every write — human, webhook, or effect worker — arrives here, and the order is fixed:
 *
 *   idempotency -> authorize -> lock row -> state check -> guard -> approval? -> write
 *                                                                   |            + audit
 *                                                                   |            + effect
 *                                                                   pending      (one tx)
 *
 * The four non-`ok` outcomes are deliberately distinct. `denied` is an authority problem,
 * `invalid` is a domain problem, `pending` needs another human, `unknown` means an external
 * system's outcome is genuinely undetermined. An app that returns 403 for the first two
 * cannot tell an attack from a typo.
 */
import { Prisma } from '@prisma/client';
import { newRequestId, recordDenial, writeAudit } from '@/substrate/audit';
import { authorize, type PolicyCatalog } from '@/substrate/authz';
import { db } from '@/substrate/db';
import { enqueueEffect } from '@/substrate/effects';
import { projectForAudit } from '@/substrate/fields';
import {
  scopeValueOf,
  transitionFor,
  type RecordDelegate,
  type ResourceDefinition,
} from '@/substrate/resource';
import {
  InvalidOperation,
  type ApprovalRule,
  type OperationResult,
  type Principal,
  type ScopedRecord,
  type Transition,
  type Tx,
} from '@/substrate/types';

export type ExecuteInput<TRecord extends Record<string, unknown>> = {
  resource: ResourceDefinition<TRecord>;
  action: string;
  recordId: string;
  principal: Principal;
  payload?: Record<string, unknown>;
  requestId?: string;
  /** Present for retryable callers (webhooks, effect settlement, form resubmits). */
  idempotencyKey?: string;
  /** Set only by the approval engine when replaying a payload that has been approved. */
  approvedRequestId?: string;
  catalog?: PolicyCatalog;
  client?: typeof db;
};

export type ExecuteOutput = OperationResult<{ id: string; state: string }>;

function scopedRecordOf<TRecord extends Record<string, unknown>>(
  def: ResourceDefinition<TRecord>,
  record: Record<string, unknown>,
): ScopedRecord {
  return {
    id: String(record.id),
    resource: def.name,
    scopeValue: scopeValueOf(def, record),
    state: typeof record.state === 'string' ? record.state : null,
    requesterId: typeof record.requesterId === 'string' ? record.requesterId : null,
    assigneeId: typeof record.assigneeId === 'string' ? record.assigneeId : null,
  };
}

async function lockAndLoad(
  tx: Tx,
  table: string,
  delegate: RecordDelegate,
  id: string,
): Promise<Record<string, unknown> | null> {
  // Lock before reading, and before the audit chain lock — see the note on CHAIN_LOCK.
  const locked = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`,
    id,
  );
  if (locked.length === 0) return null;
  return delegate.findUnique({ where: { id } });
}

export async function execute<TRecord extends Record<string, unknown>>(
  input: ExecuteInput<TRecord>,
): Promise<ExecuteOutput> {
  const {
    resource: def,
    action,
    recordId,
    principal,
    payload = {},
    idempotencyKey,
    approvedRequestId,
    catalog,
    client = db,
  } = input;
  const requestId = input.requestId ?? newRequestId();

  const transition = transitionFor(def, action);
  if (!transition) {
    return { status: 'invalid', reason: `${def.name} has no action '${action}'` };
  }

  if (idempotencyKey) {
    const replay = await client.idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
    if (replay) return replay.outcome as ExecuteOutput;
  }

  const current = await def.delegate(client).findUnique({ where: { id: recordId } });
  if (!current) return { status: 'invalid', reason: `${def.name} ${recordId} does not exist` };

  const decision = authorize(
    {
      principal,
      resource: def.name,
      action: transition.permission.split(':')[1] ?? action,
      scopeDimension: def.scope?.dimension,
      record: scopedRecordOf(def, current),
    },
    catalog,
  );
  if (!decision.allowed) {
    await recordDenial(
      {
        principal,
        resource: def.name,
        action,
        recordId,
        reason: decision.reason,
        rule: decision.rule,
        requestId,
      },
      client,
    );
    return { status: 'denied', reason: decision.reason, rule: decision.rule };
  }

  let outcome: ExecuteOutput;
  try {
    outcome = await client.$transaction(async (tx) => {
      const delegate = def.delegate(tx);
      const record = await lockAndLoad(tx, def.table, delegate, recordId);
      if (!record) return { status: 'invalid', reason: `${def.name} ${recordId} does not exist` };

      const state = String(record.state);
      if (!transition.from.includes(state)) {
        return {
          status: 'invalid',
          reason: `${def.name} ${recordId} is '${state}'; '${action}' applies to ${transition.from.join(', ')}`,
          field: 'state',
        };
      }

      const ctx = { record: record as TRecord, payload, principal, tx };
      if (transition.guard) await transition.guard(ctx);

      if (transition.requiresApproval && !approvedRequestId) {
        // Only park when a declared rule actually matches this instance; a policy that
        // applies to nothing must not block the operation.
        const rule = approvalRuleFor(def, transition, { ...record, ...payload });
        if (rule && rule.approvers > 0) {
          return park(tx, def, transition, rule, { record, payload, principal, requestId, action });
        }
      }

      const extra = transition.apply ? await transition.apply(ctx) : {};
      const updated = await delegate.update({
        where: { id: recordId },
        data: { ...extra, state: transition.to },
      });

      await writeAudit(tx, {
        kind: 'write',
        principal,
        resource: def.name,
        recordId,
        action,
        before: projectForAudit(record, def.fields, def.name),
        after: projectForAudit(updated, def.fields, def.name),
        reason: approvedRequestId ? `approved:${approvedRequestId}` : null,
        requestId,
        idempotencyKey: idempotencyKey ?? null,
      });

      const intent = transition.effect?.(ctx);
      if (intent) {
        await enqueueEffect(tx, intent, { resource: def.name, recordId, requestId });
      }

      return { status: 'ok', data: { id: recordId, state: transition.to } };
    });
  } catch (error) {
    if (error instanceof InvalidOperation) {
      return { status: 'invalid', reason: error.message, field: error.field };
    }
    throw error;
  }

  if (idempotencyKey && outcome.status !== 'denied') {
    await client.idempotencyRecord.create({
      data: {
        key: idempotencyKey,
        resource: def.name,
        recordId,
        action,
        outcome: outcome as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return outcome;
}

/**
 * Authorized and guard-checked, but parked for a human. The payload is stored verbatim so
 * that what commits later is what was reviewed — including whatever baseline the app put
 * in it (flags carry `expectedVersion`).
 */
function approvalRuleFor<TRecord extends Record<string, unknown>>(
  def: ResourceDefinition<TRecord>,
  transition: Transition<TRecord>,
  subject: Record<string, unknown>,
): ApprovalRule | null {
  const policy = def.approvals?.[transition.requiresApproval as string];
  if (!policy) return null;
  return policy.rules.find((candidate) => candidate.appliesWhen(subject)) ?? null;
}

async function park<TRecord extends Record<string, unknown>>(
  tx: Tx,
  def: ResourceDefinition<TRecord>,
  transition: Transition<TRecord>,
  rule: ApprovalRule,
  args: {
    record: Record<string, unknown>;
    payload: Record<string, unknown>;
    principal: Principal;
    requestId: string;
    action: string;
  },
): Promise<ExecuteOutput> {
  const policyName = transition.requiresApproval as string;
  const policy = def.approvals?.[policyName];
  if (!policy) return { status: 'invalid', reason: `unknown approval policy '${policyName}'` };

  const existing = await tx.approvalRequest.findFirst({
    where: { resource: def.name, recordId: String(args.record.id), action: args.action, state: 'pending' },
    select: { id: true, policy: true, requiredApprovers: true },
  });
  if (existing) {
    return {
      status: 'pending',
      approvalRequestId: existing.id,
      policy: existing.policy,
      requiredApprovers: existing.requiredApprovers,
    };
  }

  const request = await tx.approvalRequest.create({
    data: {
      resource: def.name,
      recordId: String(args.record.id),
      action: args.action,
      payload: args.payload as Prisma.InputJsonValue,
      policy: policyName,
      requiredApprovers: rule.approvers,
      eligibleRoles: rule.eligibleRoles ?? [],
      excludeRequester: policy.exclusions.excludeRequester ?? true,
      requesterId: args.principal.id,
      requestId: args.requestId,
    },
    select: { id: true },
  });

  await writeAudit(tx, {
    kind: 'decision',
    principal: args.principal,
    resource: def.name,
    recordId: String(args.record.id),
    action: `${args.action}:requested`,
    after: { approvalRequestId: request.id, payload: args.payload },
    reason: `awaiting ${rule.approvers} approval(s) under ${policyName}`,
    requestId: args.requestId,
  });

  return {
    status: 'pending',
    approvalRequestId: request.id,
    policy: policyName,
    requiredApprovers: rule.approvers,
  };
}
