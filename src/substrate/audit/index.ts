/**
 * The audit trail: append-only, hash-chained, and shared by every app.
 *
 * Four kinds of event, because three of them are the ones most systems lose:
 *   write       - domain state changed
 *   read        - a sensitive field was revealed (the gap in Dataverse's standard auditing)
 *   decision    - an approval was granted or refused
 *   auth_denied - somebody attempted something they were not permitted to do
 *
 * `writeAudit` must run inside the same transaction as the domain write it describes.
 * A deferred constraint trigger rejects any domain mutation that arrives without one, so
 * this is a database guarantee rather than a code-review convention.
 */
import { randomUUID } from 'node:crypto';
import { db } from '@/substrate/db';
import { hashEvent, type HashableEvent } from '@/substrate/audit/hash';
import type { AuditInput, AuditKind, Db, Principal, Tx } from '@/substrate/types';

/** Serializes chain appends; without it two concurrent writers can share a `prevHash`. */
const CHAIN_LOCK = 8_274_100_311n;

export function newRequestId(): string {
  return randomUUID();
}

export type WrittenAuditEvent = { seq: bigint; hash: string; prevHash: string | null };

export async function writeAudit(tx: Tx, input: AuditInput): Promise<WrittenAuditEvent> {
  const [{ txid }] = await tx.$queryRaw<{ txid: string }[]>`
    SELECT pg_advisory_xact_lock(${CHAIN_LOCK}::bigint)::text AS locked,
           txid_current()::text AS txid
  `;

  const previous = await tx.auditEvent.findFirst({
    orderBy: { seq: 'desc' },
    select: { hash: true },
  });
  const prevHash = previous?.hash ?? null;

  const event: HashableEvent = {
    kind: input.kind,
    actorId: input.principal.id,
    actorRoles: input.principal.roles,
    actorScope: input.principal.scopes,
    resource: input.resource,
    recordId: input.recordId ?? null,
    action: input.action,
    before: input.before ?? null,
    after: input.after ?? null,
    fields: input.fields ?? [],
    reason: input.reason ?? null,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey ?? null,
  };

  const hash = hashEvent(event, prevHash);

  const row = await tx.auditEvent.create({
    data: {
      kind: event.kind,
      actorId: event.actorId,
      actorRoles: event.actorRoles,
      actorScope: event.actorScope as object,
      resource: event.resource,
      recordId: event.recordId,
      action: event.action,
      before: (event.before ?? undefined) as object | undefined,
      after: (event.after ?? undefined) as object | undefined,
      fields: event.fields,
      reason: event.reason,
      requestId: event.requestId,
      idempotencyKey: event.idempotencyKey,
      txId: BigInt(txid),
      prevHash,
      hash,
    },
    select: { seq: true, hash: true },
  });

  return { seq: row.seq, hash: row.hash, prevHash };
}

/**
 * For events that have no accompanying domain write — denials and sensitive reads.
 * These get their own transaction so that a denial is still recorded when the operation
 * it belongs to is aborted.
 */
export async function writeAuditStandalone(
  input: AuditInput,
  client: Db = db,
): Promise<WrittenAuditEvent> {
  return client.$transaction((tx) => writeAudit(tx, input));
}

export async function recordDenial(
  args: {
    principal: Principal;
    resource: string;
    action: string;
    recordId?: string | null;
    reason: string;
    rule?: string;
    requestId: string;
  },
  client: Db = db,
): Promise<WrittenAuditEvent> {
  return writeAuditStandalone(
    {
      kind: 'auth_denied',
      principal: args.principal,
      resource: args.resource,
      action: args.action,
      recordId: args.recordId ?? null,
      reason: args.rule ? `${args.rule}: ${args.reason}` : args.reason,
      requestId: args.requestId,
    },
    client,
  );
}

/** A sensitive read is an operation. `fields` is the list actually revealed. */
export async function recordRead(
  args: {
    principal: Principal;
    resource: string;
    recordId: string;
    fields: string[];
    action?: string;
    reason?: string | null;
    requestId: string;
  },
  client: Db = db,
): Promise<WrittenAuditEvent | null> {
  if (args.fields.length === 0) return null;
  return writeAuditStandalone(
    {
      kind: 'read',
      principal: args.principal,
      resource: args.resource,
      recordId: args.recordId,
      action: args.action ?? 'reveal_pii',
      fields: args.fields,
      reason: args.reason ?? null,
      requestId: args.requestId,
    },
    client,
  );
}

export type ChainVerification =
  | { ok: true; checked: number }
  | { ok: false; checked: number; brokenAtSeq: string; problem: 'hash_mismatch' | 'broken_link' };

/**
 * Walks the chain and reports the first break. Tamper-evidence you can demonstrate is
 * worth more than tamper-evidence you assert.
 */
export async function verifyAuditChain(client: Db = db, batchSize = 500): Promise<ChainVerification> {
  let cursor: bigint | null = null;
  let expectedPrev: string | null = null;
  let checked = 0;

  for (;;) {
    const rows: Awaited<ReturnType<typeof client.auditEvent.findMany>> =
      await client.auditEvent.findMany({
        where: cursor === null ? undefined : { seq: { gt: cursor } },
        orderBy: { seq: 'asc' },
        take: batchSize,
      });
    if (rows.length === 0) return { ok: true, checked };

    for (const row of rows) {
      if (row.prevHash !== expectedPrev) {
        return {
          ok: false,
          checked,
          brokenAtSeq: row.seq.toString(),
          problem: 'broken_link',
        };
      }

      const recomputed = hashEvent(
        {
          kind: row.kind,
          actorId: row.actorId,
          actorRoles: row.actorRoles,
          actorScope: row.actorScope,
          resource: row.resource,
          recordId: row.recordId,
          action: row.action,
          before: row.before ?? null,
          after: row.after ?? null,
          fields: row.fields,
          reason: row.reason,
          requestId: row.requestId,
          idempotencyKey: row.idempotencyKey,
        },
        row.prevHash,
      );

      if (recomputed !== row.hash) {
        return { ok: false, checked, brokenAtSeq: row.seq.toString(), problem: 'hash_mismatch' };
      }

      expectedPrev = row.hash;
      cursor = row.seq;
      checked += 1;
    }
  }
}

export const AUDIT_KINDS: AuditKind[] = ['write', 'read', 'decision', 'auth_denied'];
