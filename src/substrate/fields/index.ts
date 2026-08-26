/**
 * Field policy and `project()` — the only serializer in the system.
 *
 * Detail views, list rows, API responses, CSV exports and the audit trail all pass
 * through this function. That is the point: masking that only one code path applies is
 * masking that the CSV export will eventually leak around.
 *
 * A masked value is never sent to the client at all. Rendering the real SSN and hiding it
 * with CSS would satisfy a screenshot and nothing else.
 */
import { authorize, type PolicyCatalog } from '@/substrate/authz';
import type {
  FieldPolicy,
  MaskStrategy,
  Principal,
  Projected,
  ScopeDimension,
  ScopedRecord,
} from '@/substrate/types';

const HIDDEN = '••••';

export function maskValue(value: unknown, strategy: MaskStrategy): unknown {
  if (value === null || value === undefined) return value;

  switch (strategy) {
    case 'omit':
      return undefined;
    case 'redact':
      return HIDDEN;
    case 'last4': {
      const text = String(value);
      const tail = text.slice(-4);
      return text.length <= 4 ? HIDDEN : `${HIDDEN}${tail}`;
    }
    case 'partial': {
      const text = String(value);
      if (text.length <= 4) return HIDDEN;
      return `${text.slice(0, 2)}${HIDDEN}${text.slice(-2)}`;
    }
    case 'date_year': {
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime()) ? HIDDEN : String(date.getUTCFullYear());
    }
  }
}

export type ProjectInput<T extends Record<string, unknown>> = {
  record: T;
  policy: FieldPolicy;
  resource: string;
  /**
   * Omitted for system serialization (audit payloads), which masks everything: the
   * tamper-evident trail must not quietly become the largest store of raw PII.
   */
  principal?: Principal;
  /** Fields the caller is explicitly asking to reveal. Each reveal is authorized. */
  reveal?: string[];
  scopeDimension?: ScopeDimension;
  /** Scope/SoD context, so a reveal is checked against *this* record. */
  scopedRecord?: ScopedRecord;
  catalog?: PolicyCatalog;
};

function canReveal<T extends Record<string, unknown>>(
  input: ProjectInput<T>,
  revealPermission: string,
): boolean {
  if (!input.principal) return false;
  const [resource, action] = revealPermission.split(':');
  if (!resource || !action) return false;
  const decision = authorize(
    {
      principal: input.principal,
      resource,
      action,
      scopeDimension: input.scopeDimension,
      record: input.scopedRecord,
    },
    input.catalog,
  );
  return decision.allowed;
}

export function project<T extends Record<string, unknown>>(input: ProjectInput<T>): Projected {
  const { record, policy, reveal = [] } = input;
  const requested = new Set(reveal);

  const data: Record<string, unknown> = {};
  const masked: string[] = [];
  const revealed: string[] = [];
  const revealable: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    const rule = policy[key];
    if (!rule || rule.sensitivity === 'public') {
      data[key] = value;
      continue;
    }

    const allowed = canReveal(input, rule.revealPermission);
    if (allowed) revealable.push(key);

    if (allowed && requested.has(key)) {
      data[key] = value;
      revealed.push(key);
      continue;
    }

    const maskedValue = maskValue(value, rule.mask);
    if (maskedValue !== undefined) data[key] = maskedValue;
    masked.push(key);
  }

  return { data, masked, revealed, revealable };
}

/** Convenience for audit payloads and any other system-side serialization. */
export function projectForAudit<T extends Record<string, unknown>>(
  record: T,
  policy: FieldPolicy,
  resource: string,
): Record<string, unknown> {
  return project({ record, policy, resource }).data;
}
