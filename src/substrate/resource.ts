/**
 * The declaration seam. An app describes its resource; the substrate supplies the
 * machinery. Everything here is data — a resource definition contains no authorization,
 * audit, approval or retry logic, because those exist once, below it.
 */
import type {
  ApprovalPolicy,
  FieldPolicy,
  Principal,
  ScopeDimension,
  StateMachine,
  Tx,
} from '@/substrate/types';

/**
 * The subset of a Prisma model delegate the substrate needs. Apps pass their own
 * delegate (`(tx) => tx.refund`), so the substrate never has to know the model union.
 */
export type RecordDelegate = {
  findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, 'asc' | 'desc'>;
    take?: number;
  }): Promise<Record<string, unknown>[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
};

/**
 * Creating a record is an operation too. It has no current state to check and no row to
 * lock, but it still needs a permission, a guard and an audit row, so it is declared here
 * rather than left to each app's route handler.
 */
export type CreationPolicy = {
  permission: string;
  guard?: (ctx: {
    data: Record<string, unknown>;
    principal: Principal;
    tx: Tx;
  }) => Promise<void> | void;
  /**
   * Fields the record owns rather than the caller: computed in the same transaction as the
   * insert and merged over the submitted data, so a client cannot supply them.
   */
  derive?: (ctx: {
    data: Record<string, unknown>;
    principal: Principal;
    tx: Tx;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

export type ResourceDefinition<TRecord extends Record<string, unknown>> = {
  /** Permission namespace and audit `resource`, e.g. 'refund'. */
  name: string;
  /** Physical table name; used for `SELECT ... FOR UPDATE`. */
  table: string;
  label: string;
  delegate: (tx: Tx) => RecordDelegate;
  /** Which axis this resource is scoped along, and the column holding the scope value. */
  scope?: { dimension: ScopeDimension; field: string };
  fields: FieldPolicy;
  machine: StateMachine<TRecord>;
  /** Referenced by name from `Transition.requiresApproval`. */
  approvals?: Record<string, ApprovalPolicy>;
  /** Omitted for resources that only ever arrive from outside (KYC cases, payments). */
  creation?: CreationPolicy;
};

export function defineResource<TRecord extends Record<string, unknown>>(
  def: ResourceDefinition<TRecord>,
): ResourceDefinition<TRecord> {
  const states = new Set(def.machine.states);
  for (const transition of def.machine.transitions) {
    for (const state of [...transition.from, transition.to]) {
      if (!states.has(state)) {
        throw new Error(
          `${def.name}.${transition.action} references state '${state}' that is not declared`,
        );
      }
    }
    if (transition.requiresApproval && !def.approvals?.[transition.requiresApproval]) {
      throw new Error(
        `${def.name}.${transition.action} requires approval policy '${transition.requiresApproval}' which is not declared`,
      );
    }
  }
  return def;
}

export function transitionFor<TRecord extends Record<string, unknown>>(
  def: ResourceDefinition<TRecord>,
  action: string,
) {
  return def.machine.transitions.find((t) => t.action === action);
}

export function scopeValueOf<TRecord extends Record<string, unknown>>(
  def: ResourceDefinition<TRecord>,
  record: Record<string, unknown>,
): string | null {
  if (!def.scope) return null;
  const value = record[def.scope.field];
  return typeof value === 'string' ? value : null;
}
