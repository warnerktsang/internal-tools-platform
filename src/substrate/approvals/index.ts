/**
 * Approvals and separation of duties.
 *
 * One polymorphic pair of tables for every app, because "who else had to agree" is the same
 * mechanism everywhere; only the *declaration* differs (a refund threshold, a compliance
 * rejection, a production rollout). The requester never approves their own request, and the
 * replay commits the payload that was reviewed — not the state of the world at approval time.
 */
import { newRequestId, recordDenial, writeAudit } from '@/substrate/audit';
import { authorize, type PolicyCatalog } from '@/substrate/authz';
import { db } from '@/substrate/db';
import { getPrincipalById } from '@/substrate/identity';
import { execute, type ExecuteOutput } from '@/substrate/operations';
import { scopeValueOf, type ResourceDefinition } from '@/substrate/resource';
import type { Principal } from '@/substrate/types';

export type DecisionInput<TRecord extends Record<string, unknown>> = {
  resource: ResourceDefinition<TRecord>;
  approvalRequestId: string;
  approver: Principal;
  decision: 'approved' | 'rejected';
  note?: string;
  requestId?: string;
  catalog?: PolicyCatalog;
  client?: typeof db;
};

export type DecisionResult =
  | { status: 'denied'; reason: string; rule?: string }
  | { status: 'invalid'; reason: string }
  /** Recorded, but the request still needs more approvers. */
  | { status: 'recorded'; remaining: number }
  | { status: 'rejected' }
  /** The final approval landed, so the parked operation ran; this is its result. */
  | { status: 'applied'; result: ExecuteOutput };

export async function decide<TRecord extends Record<string, unknown>>(
  input: DecisionInput<TRecord>,
): Promise<DecisionResult> {
  const {
    resource: def,
    approvalRequestId,
    approver,
    decision,
    note,
    catalog,
    client = db,
  } = input;
  const requestId = input.requestId ?? newRequestId();

  const request = await client.approvalRequest.findUnique({
    where: { id: approvalRequestId },
    include: { approvals: true },
  });
  if (!request) return { status: 'invalid', reason: 'approval request does not exist' };
  if (request.resource !== def.name) {
    return { status: 'invalid', reason: 'approval request belongs to another resource' };
  }
  if (request.state !== 'pending') {
    return { status: 'invalid', reason: `approval request is already ${request.state}` };
  }

  const record = await def.delegate(client).findUnique({ where: { id: request.recordId } });
  if (!record) return { status: 'invalid', reason: `${def.name} ${request.recordId} does not exist` };

  const denial = await eligibility({ def, request, approver, record, catalog });
  if (denial) {
    await recordDenial(
      {
        principal: approver,
        resource: def.name,
        action: `${request.action}:approve`,
        recordId: request.recordId,
        reason: denial.reason,
        rule: denial.rule,
        requestId,
      },
      client,
    );
    return { status: 'denied', ...denial };
  }

  // The unique (requestId, approverId) constraint is what actually stops double-counting.
  try {
    await client.$transaction(async (tx) => {
      await tx.approval.create({
        data: { requestId: request.id, approverId: approver.id, decision, note },
      });
      await writeAudit(tx, {
        kind: 'decision',
        principal: approver,
        resource: def.name,
        recordId: request.recordId,
        action: `${request.action}:${decision}`,
        after: { approvalRequestId: request.id, decision },
        reason: note ?? null,
        requestId,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { status: 'invalid', reason: 'you have already decided on this request' };
    }
    throw error;
  }

  if (decision === 'rejected') {
    await client.approvalRequest.update({
      where: { id: request.id },
      data: { state: 'rejected', resolvedAt: new Date() },
    });
    return { status: 'rejected' };
  }

  const approvals = await client.approval.count({
    where: { requestId: request.id, decision: 'approved' },
  });
  const remaining = request.requiredApprovers - approvals;
  if (remaining > 0) return { status: 'recorded', remaining };

  // Claim the request before replaying it. Two approvers whose decisions land together can
  // both see enough approvals; only the one that wins this conditional update replays.
  const claim = await client.approvalRequest.updateMany({
    where: { id: request.id, state: 'pending' },
    data: { state: 'applying' },
  });
  if (claim.count === 0) return { status: 'recorded', remaining: 0 };

  const requester = await getPrincipalById(request.requesterId);
  if (!requester) {
    await client.approvalRequest.update({ where: { id: request.id }, data: { state: 'pending' } });
    return { status: 'invalid', reason: 'requester no longer exists' };
  }

  const payload =
    request.payload !== null && typeof request.payload === 'object' && !Array.isArray(request.payload)
      ? (request.payload as Record<string, unknown>)
      : {};

  // Replayed as the requester: their authority is what was reviewed. The guard runs again,
  // so a change whose baseline moved while parked fails here instead of silently applying.
  const result = await execute({
    resource: def,
    action: request.action,
    recordId: request.recordId,
    principal: requester,
    payload,
    requestId,
    approvedRequestId: request.id,
    catalog,
    client,
  });

  await client.approvalRequest.update({
    where: { id: request.id },
    data: { state: result.status === 'ok' ? 'approved' : 'stale', resolvedAt: new Date() },
  });

  return { status: 'applied', result };
}

export type ApprovalEligibility = {
  requesterId: string;
  excludeRequester: boolean;
  eligibleRoles: string[];
};

/**
 * The one place separation of duties and role eligibility are decided, so the approver's
 * queue, the buttons rendered on a record, and `decide()` itself cannot disagree about who
 * may approve. Pure and synchronous: it needs the parked request, not the record.
 */
export function approvalRefusal(
  request: ApprovalEligibility,
  approver: Principal,
): { reason: string; rule: string } | null {
  if (request.excludeRequester && approver.id === request.requesterId) {
    return {
      reason: 'you requested this change; a different person must approve it',
      rule: 'separation_of_duties',
    };
  }

  if (
    request.eligibleRoles.length > 0 &&
    !request.eligibleRoles.some((role) => approver.roles.includes(role))
  ) {
    return {
      reason: `approval requires one of: ${request.eligibleRoles.join(', ')}`,
      rule: 'eligible_roles',
    };
  }

  return null;
}

async function eligibility<TRecord extends Record<string, unknown>>(args: {
  def: ResourceDefinition<TRecord>;
  request: { requesterId: string; excludeRequester: boolean; eligibleRoles: string[]; action: string };
  approver: Principal;
  record: Record<string, unknown>;
  catalog?: PolicyCatalog;
}): Promise<{ reason: string; rule?: string } | null> {
  const { def, request, approver, record, catalog } = args;

  const refusal = approvalRefusal(request, approver);
  if (refusal) return refusal;

  const decision = authorize(
    {
      principal: approver,
      resource: def.name,
      action: 'approve',
      scopeDimension: def.scope?.dimension,
      record: {
        id: String(record.id),
        resource: def.name,
        scopeValue: scopeValueOf(def, record),
        state: typeof record.state === 'string' ? record.state : null,
        requesterId: typeof record.requesterId === 'string' ? record.requesterId : null,
      },
    },
    catalog,
  );
  return decision.allowed ? null : { reason: decision.reason, rule: decision.rule };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/** The approver's queue: pending requests they are eligible to decide. */
export async function pendingApprovalsFor(
  principal: Principal,
  client: typeof db = db,
): Promise<
  { id: string; resource: string; recordId: string; action: string; requesterId: string; createdAt: Date }[]
> {
  const rows = await client.approvalRequest.findMany({
    where: { state: 'pending' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      resource: true,
      recordId: true,
      action: true,
      requesterId: true,
      createdAt: true,
      excludeRequester: true,
      eligibleRoles: true,
    },
  });

  return rows
    .filter((row) => approvalRefusal(row, principal) === null)
    .map(({ excludeRequester: _e, eligibleRoles: _r, ...rest }) => rest);
}
