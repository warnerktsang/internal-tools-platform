import { createHash } from 'node:crypto';

/**
 * Deterministic serialization. A hash chain is only tamper-evident if two processes
 * hashing the same event agree byte for byte, so key order and date formatting cannot be
 * left to `JSON.stringify`'s defaults.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export type HashableEvent = {
  kind: string;
  actorId: string;
  actorRoles: string[];
  actorScope: unknown;
  resource: string;
  recordId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  fields: string[];
  reason: string | null;
  requestId: string;
  idempotencyKey: string | null;
};

export function hashEvent(event: HashableEvent, prevHash: string | null): string {
  return createHash('sha256')
    .update(canonicalize({ prevHash, ...event }))
    .digest('hex');
}
