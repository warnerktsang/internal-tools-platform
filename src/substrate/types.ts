/**
 * The vocabulary every app is written in. Twelve concepts: Principal, Role, Permission,
 * DenyRule, Resource, Record, FieldPolicy, Operation, Transition, Guard, ApprovalPolicy,
 * AuditEvent (plus Port/Effect for external systems).
 *
 * Apps declare. The substrate enforces.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Scoping axis. KYC and refunds scope by business unit; flags scope by environment. */
export type ScopeDimension = 'business_unit' | 'environment';

export const GLOBAL_SCOPE = '*';

export type Principal = {
  id: string;
  kind: 'human' | 'system';
  email: string | null;
  displayName: string;
  title: string | null;
  roles: string[];
  /** e.g. { business_unit: ['us'], environment: ['dev','staging'] }; '*' means global. */
  scopes: Partial<Record<ScopeDimension, string[]>>;
};

/**
 * The only thing the platform knows about authentication. Swapping seeded identities for
 * OIDC means implementing this interface; nothing downstream changes.
 */
export type IdentityProvider = {
  name: string;
  getPrincipal(): Promise<Principal | null>;
};

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/** `resource:action`, e.g. 'refund:approve'. */
export type Permission = string;

export type Role = {
  name: string;
  description: string;
  permissions: Permission[];
  /** 'own_scope' honours the principal's scope grants; 'global' ignores them. */
  grant: 'own_scope' | 'global';
};

export type DenyContext = {
  principal: Principal;
  resource: string;
  action: string;
  record?: ScopedRecord;
};

/** Evaluated last, and deny always wins. Additive-only role systems cannot express these. */
export type DenyRule = {
  name: string;
  reason: string;
  when(ctx: DenyContext): boolean;
};

/** The minimum the policy engine needs to know about a record instance. */
export type ScopedRecord = {
  id: string;
  resource: string;
  scopeValue: string | null;
  state?: string | null;
  /** Used by separation-of-duties checks. */
  requesterId?: string | null;
  assigneeId?: string | null;
};

export type AuthorizeDecision =
  | { allowed: true }
  | { allowed: false; reason: string; rule?: string };

// ---------------------------------------------------------------------------
// Data / field policy
// ---------------------------------------------------------------------------

export type Sensitivity = 'public' | 'sensitive' | 'restricted';
export type MaskStrategy = 'last4' | 'redact' | 'partial' | 'omit' | 'date_year';

export type FieldRule = {
  sensitivity: Sensitivity;
  mask: MaskStrategy;
  revealPermission: Permission;
};

export type FieldPolicy = Record<string, FieldRule>;

export type Projected = {
  data: Record<string, unknown>;
  masked: string[];
  revealed: string[];
  /** Fields this principal *could* reveal, so the UI can offer it without guessing. */
  revealable: string[];
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type OperationStatus = 'ok' | 'pending' | 'denied' | 'invalid' | 'unknown';

export type OperationResult<T = unknown> =
  | { status: 'ok'; data: T }
  | { status: 'pending'; approvalRequestId: string; policy: string; requiredApprovers: number }
  | { status: 'denied'; reason: string; rule?: string }
  | { status: 'invalid'; reason: string; field?: string }
  | { status: 'unknown'; effectId: string; reason: string };

/** Thrown by guards; converted into `{ status: 'invalid' }`. */
export class InvalidOperation extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'InvalidOperation';
  }
}

export function invalid(reason: string, field?: string): never {
  throw new InvalidOperation(reason, field);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export type GuardContext<TRecord = Record<string, unknown>> = {
  record: TRecord;
  payload: Record<string, unknown>;
  principal: Principal;
  tx: Tx;
};

/** App-specific correctness. Runs inside the transaction, on locked rows. */
export type Guard<TRecord = Record<string, unknown>> = (
  ctx: GuardContext<TRecord>,
) => Promise<void> | void;

export type Transition<TRecord = Record<string, unknown>> = {
  action: string;
  from: string[];
  to: string;
  permission: Permission;
  /** Name of an approval policy declared on the resource. */
  requiresApproval?: string;
  guard?: Guard<TRecord>;
  /** Extra columns to write alongside the state change. */
  apply?: (ctx: GuardContext<TRecord>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Declares an external effect enqueued in the same transaction as the write. */
  effect?: (ctx: GuardContext<TRecord>) => EffectIntent | null;
};

export type StateMachine<TRecord = Record<string, unknown>> = {
  initial: string;
  states: string[];
  transitions: Transition<TRecord>[];
};

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export type ApprovalRule = {
  appliesWhen: (subject: Record<string, unknown>) => boolean;
  approvers: number;
  eligibleRoles?: string[];
};

export type ApprovalPolicy = {
  name: string;
  rules: ApprovalRule[];
  exclusions: {
    /** Separation of duties: the requester may never approve their own request. */
    excludeRequester?: boolean;
    /** One human may not fill two approver slots. */
    excludeSelf?: boolean;
  };
};

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type AuditKind = 'write' | 'read' | 'decision' | 'auth_denied';

export type AuditInput = {
  kind: AuditKind;
  principal: Principal;
  resource: string;
  recordId?: string | null;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  fields?: string[];
  reason?: string | null;
  requestId: string;
  idempotencyKey?: string | null;
};

// ---------------------------------------------------------------------------
// External systems
// ---------------------------------------------------------------------------

export type EffectIntent = {
  port: string;
  operation: string;
  payload: Record<string, unknown>;
  /** Carried through to the external call, so a retry cannot double-apply. */
  idempotencyKey: string;
};

export type PortOutcome =
  | { status: 'succeeded'; result?: Record<string, unknown> }
  | { status: 'failed'; error: string }
  /** A timeout is not a failure: the real-world outcome is genuinely undetermined. */
  | { status: 'unknown'; error: string };

export type Port = {
  name: string;
  operations: Record<
    string,
    {
      kind: 'effect' | 'query';
      execute(payload: Record<string, unknown>, idempotencyKey: string): Promise<PortOutcome>;
    }
  >;
};
