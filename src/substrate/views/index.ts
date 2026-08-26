/**
 * The generated read path. Lists, detail views and history are produced from a registered
 * resource, so no app writes a query that could forget the scope predicate or the mask.
 *
 * Three properties matter here and all three are server-side:
 *   - scope is a predicate in the query, never a filter applied to fetched rows;
 *   - every value leaves through `project()`, so a masked field never reaches the browser;
 *   - action availability is decided here and sent as data, so the client renders a
 *     decision it cannot make or overturn.
 */
import { approvalRefusal } from '@/substrate/approvals';
import { newRequestId, recordDenial, recordRead } from '@/substrate/audit';
import { authorize, hasPermission, scopeAccess, scopeFilter, type PolicyCatalog } from '@/substrate/authz';
import { db } from '@/substrate/db';
import { project } from '@/substrate/fields';
import type { RegisteredResource } from '@/substrate/registry';
import { scopeValueOf } from '@/substrate/resource';
import type { Db, Principal, ScopedRecord, Transition } from '@/substrate/types';

export type AvailableAction = {
  action: string;
  available: boolean;
  /** Why not, when unavailable: an authorization reason or a state reason. */
  reason?: string;
  requiresApproval?: string;
};

export type ViewRow = {
  id: string;
  state: string | null;
  data: Record<string, unknown>;
  masked: string[];
  actions: AvailableAction[];
};

/** Surfaced so the UI can say "scoped to us" rather than implying the list is everything. */
export type ScopeSummary = { dimension: string; mode: string; values?: string[] };

export type ListView =
  | { status: 'denied'; reason: string }
  | { status: 'ok'; rows: ViewRow[]; total: number; scope: ScopeSummary | null };

export type DetailView =
  | { status: 'denied'; reason: string }
  | { status: 'missing' }
  | {
      status: 'ok';
      row: ViewRow;
      revealable: string[];
      revealed: string[];
      history: HistoryEntry[];
      pendingApprovals: {
        id: string;
        action: string;
        requesterId: string;
        requiredApprovers: number;
        /** Whether *this* principal may decide it, and why not. Decided server-side. */
        decidable: { available: boolean; reason?: string };
      }[];
    };

export type HistoryEntry = {
  seq: string;
  at: Date;
  kind: string;
  action: string;
  actorId: string;
  actorRoles: string[];
  fields: string[];
  reason: string | null;
};

function scopedRecordOf(entry: RegisteredResource, record: Record<string, unknown>): ScopedRecord {
  return {
    id: String(record.id),
    resource: entry.def.name,
    scopeValue: scopeValueOf(entry.def, record),
    state: typeof record.state === 'string' ? record.state : null,
    requesterId: typeof record.requesterId === 'string' ? record.requesterId : null,
    assigneeId: typeof record.assigneeId === 'string' ? record.assigneeId : null,
  };
}

/**
 * What this principal may do to this record right now: the permission check and the state
 * machine, evaluated together. The UI never re-derives this.
 */
export function availableActions(
  entry: RegisteredResource,
  record: Record<string, unknown>,
  principal: Principal,
  catalog?: PolicyCatalog,
): AvailableAction[] {
  const state = typeof record.state === 'string' ? record.state : null;

  return entry.def.machine.transitions.map((transition: Transition) => {
    const decision = authorize(
      {
        principal,
        resource: entry.def.name,
        action: transition.permission.split(':')[1] ?? transition.action,
        scopeDimension: entry.def.scope?.dimension,
        record: scopedRecordOf(entry, record),
      },
      catalog,
    );
    if (!decision.allowed) {
      return { action: transition.action, available: false, reason: decision.reason };
    }
    if (state !== null && !transition.from.includes(state)) {
      return {
        action: transition.action,
        available: false,
        reason: `only available while ${transition.from.join(' or ')}`,
      };
    }
    // Record-level preconditions the app declares ("you do not hold this case"). Advisory
    // only: the guard inside the transaction is what actually refuses.
    const unavailable = transition.availableWhen?.({ record, principal }) ?? null;
    if (unavailable !== null) {
      return { action: transition.action, available: false, reason: unavailable };
    }
    return {
      action: transition.action,
      available: true,
      requiresApproval: transition.requiresApproval,
    };
  });
}

function toRow(
  entry: RegisteredResource,
  record: Record<string, unknown>,
  principal: Principal,
  reveal: string[],
  catalog?: PolicyCatalog,
) {
  const projected = project({
    record,
    policy: entry.def.fields,
    resource: entry.def.name,
    principal,
    reveal,
    scopeDimension: entry.def.scope?.dimension,
    scopedRecord: scopedRecordOf(entry, record),
    catalog,
  });

  return {
    row: {
      id: String(record.id),
      state: typeof record.state === 'string' ? record.state : null,
      data: projected.data,
      masked: projected.masked,
      actions: availableActions(entry, record, principal, catalog),
    } satisfies ViewRow,
    projected,
  };
}

export async function listView(
  entry: RegisteredResource,
  principal: Principal,
  options: { take?: number; where?: Record<string, unknown>; catalog?: PolicyCatalog; client?: Db } = {},
): Promise<ListView> {
  const { take = 50, where = {}, catalog, client = db } = options;

  if (!hasPermission(principal, `${entry.def.name}:read`, catalog)) {
    return { status: 'denied', reason: `you cannot read ${entry.def.label.toLowerCase()}s` };
  }

  const dimension = entry.def.scope?.dimension;
  const predicate = { ...where };
  let scope: ScopeSummary | null = null;

  if (dimension && entry.def.scope) {
    const filter = scopeFilter(principal, dimension, entry.def.name, 'read', catalog);
    if (filter) predicate[entry.def.scope.field] = filter;
    const access = scopeAccess(principal, dimension, entry.def.name, 'read', catalog);
    scope = {
      dimension,
      mode: access.mode,
      values: access.mode === 'scoped' ? access.values : undefined,
    };
  }

  const delegate = entry.def.delegate(client);
  const [records, total] = await Promise.all([
    delegate.findMany({ where: predicate, orderBy: entry.orderBy, take }),
    delegate.count({ where: predicate }),
  ]);

  return {
    status: 'ok',
    rows: records.map((record) => toRow(entry, record, principal, [], catalog).row),
    total,
    scope,
  };
}

export async function detailView(
  entry: RegisteredResource,
  recordId: string,
  principal: Principal,
  options: { reveal?: string[]; catalog?: PolicyCatalog; client?: Db; requestId?: string } = {},
): Promise<DetailView> {
  const { reveal = [], catalog, client = db } = options;
  const requestId = options.requestId ?? newRequestId();

  const record = await entry.def.delegate(client).findUnique({ where: { id: recordId } });
  if (!record) return { status: 'missing' };

  const decision = authorize(
    {
      principal,
      resource: entry.def.name,
      action: 'read',
      scopeDimension: entry.def.scope?.dimension,
      record: scopedRecordOf(entry, record),
    },
    catalog,
  );
  if (!decision.allowed) {
    // A refused read is itself evidence, and the cross-business-unit attempt is exactly
    // the event a compliance reviewer wants to find.
    await recordDenial(
      {
        principal,
        resource: entry.def.name,
        action: 'read',
        recordId,
        reason: decision.reason,
        rule: decision.rule,
        requestId,
      },
      client,
    );
    return { status: 'denied', reason: decision.reason };
  }

  const { row, projected } = toRow(entry, record, principal, reveal, catalog);

  await recordRead(
    {
      principal,
      resource: entry.def.name,
      recordId,
      fields: projected.revealed,
      requestId,
    },
    client,
  );

  const [history, pendingApprovals] = await Promise.all([
    client.auditEvent.findMany({
      where: { resource: entry.def.name, recordId },
      orderBy: { seq: 'desc' },
      take: 50,
      select: {
        seq: true,
        createdAt: true,
        kind: true,
        action: true,
        actorId: true,
        actorRoles: true,
        fields: true,
        reason: true,
      },
    }),
    client.approvalRequest.findMany({
      where: { resource: entry.def.name, recordId, state: 'pending' },
      select: {
        id: true,
        action: true,
        requesterId: true,
        requiredApprovers: true,
        excludeRequester: true,
        eligibleRoles: true,
      },
    }),
  ]);

  return {
    status: 'ok',
    row,
    revealable: projected.revealable,
    revealed: projected.revealed,
    history: history.map(({ createdAt, seq, ...event }) => ({
      ...event,
      seq: seq.toString(),
      at: createdAt,
    })),
    // Same rule `decide()` will apply, so an ineligible principal is never offered a
    // button that would only be refused: the request is still listed, with the reason.
    pendingApprovals: pendingApprovals.map(
      ({ excludeRequester, eligibleRoles, ...request }) => {
        const refusal = approvalRefusal(
          { requesterId: request.requesterId, excludeRequester, eligibleRoles },
          principal,
        );
        return {
          ...request,
          decidable: refusal ? { available: false, reason: refusal.reason } : { available: true },
        };
      },
    ),
  };
}
