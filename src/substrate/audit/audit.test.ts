import { beforeEach, describe, expect, it } from 'vitest';
import {
  recordDenial,
  recordRead,
  verifyAuditChain,
  writeAudit,
  writeAuditStandalone,
} from '@/substrate/audit';
import { canonicalize, hashEvent } from '@/substrate/audit/hash';
import { db } from '@/substrate/db';
import { principal } from '@/test/factories';
import { resetDatabase, seedPrincipal } from '@/test/db';

const dana = principal({ id: 'dana', roles: ['kyc_analyst'], scopes: { business_unit: ['us'] } });
const requestId = '00000000-0000-4000-8000-000000000001';

beforeEach(async () => {
  await resetDatabase();
  await seedPrincipal(dana);
});

describe('canonical hashing', () => {
  it('is independent of key order', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it('changes when any hashed field changes', () => {
    const base = {
      kind: 'write',
      actorId: 'dana',
      actorRoles: ['kyc_analyst'],
      actorScope: { business_unit: ['us'] },
      resource: 'kyc_case',
      recordId: 'case-1',
      action: 'approve',
      before: { state: 'in_review' },
      after: { state: 'approved' },
      fields: [],
      reason: null,
      requestId,
      idempotencyKey: null,
    };
    const hash = hashEvent(base, null);
    expect(hashEvent({ ...base, action: 'reject' }, null)).not.toBe(hash);
    expect(hashEvent(base, 'abc')).not.toBe(hash);
  });
});

describe('audit chain', () => {
  it('links each event to its predecessor and verifies end to end', async () => {
    const first = await writeAuditStandalone({
      kind: 'write',
      principal: dana,
      resource: 'kyc_case',
      recordId: 'case-1',
      action: 'claim',
      after: { state: 'in_review' },
      requestId,
    });
    const second = await writeAuditStandalone({
      kind: 'write',
      principal: dana,
      resource: 'kyc_case',
      recordId: 'case-1',
      action: 'approve',
      before: { state: 'in_review' },
      after: { state: 'approved' },
      requestId,
    });

    expect(first.prevHash).toBeNull();
    expect(second.prevHash).toBe(first.hash);
    await expect(verifyAuditChain()).resolves.toEqual({ ok: true, checked: 2 });
  });

  it('records the postgres transaction id of the writing transaction', async () => {
    const seqs = await db.$transaction(async (tx) => [
      await writeAudit(tx, {
        kind: 'write',
        principal: dana,
        resource: 'kyc_case',
        recordId: 'case-1',
        action: 'claim',
        requestId,
      }),
      await writeAudit(tx, {
        kind: 'read',
        principal: dana,
        resource: 'kyc_case',
        recordId: 'case-1',
        action: 'reveal_pii',
        fields: ['ssn'],
        requestId,
      }),
    ]);

    const rows = await db.auditEvent.findMany({
      where: { seq: { in: seqs.map((s) => s.seq) } },
      orderBy: { seq: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].txId).toBe(rows[1].txId);
    expect(rows[0].txId > 0n).toBe(true);
  });

  it('detects a tampered payload', async () => {
    await writeAuditStandalone({
      kind: 'write',
      principal: dana,
      resource: 'kyc_case',
      recordId: 'case-1',
      action: 'approve',
      after: { state: 'approved' },
      requestId,
    });

    // Tampering has to bypass the append-only trigger to happen at all, which is the
    // point: it takes database-owner privileges, and the chain still shows it.
    await db.$executeRawUnsafe(`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`);
    await db.$executeRawUnsafe(`UPDATE audit_events SET action = 'reject'`);
    await db.$executeRawUnsafe(`ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only`);

    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toBe('hash_mismatch');
  });

  it('detects a deleted event as a broken link', async () => {
    for (const action of ['claim', 'reveal', 'approve']) {
      await writeAuditStandalone({
        kind: 'write',
        principal: dana,
        resource: 'kyc_case',
        recordId: 'case-1',
        action,
        requestId,
      });
    }

    await db.$executeRawUnsafe(`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`);
    await db.$executeRawUnsafe(
      `DELETE FROM audit_events WHERE seq = (SELECT min(seq) + 1 FROM audit_events)`,
    );
    await db.$executeRawUnsafe(`ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only`);

    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toBe('broken_link');
  });

  it('keeps the chain intact under concurrent writers', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        writeAuditStandalone({
          kind: 'write',
          principal: dana,
          resource: 'kyc_case',
          recordId: `case-${i}`,
          action: 'claim',
          requestId,
        }),
      ),
    );

    const hashes = await db.auditEvent.findMany({ select: { prevHash: true } });
    expect(new Set(hashes.map((row) => row.prevHash)).size).toBe(8);
    await expect(verifyAuditChain()).resolves.toEqual({ ok: true, checked: 8 });
  });

  it('verifies across batch boundaries', async () => {
    for (let i = 0; i < 7; i += 1) {
      await writeAuditStandalone({
        kind: 'write',
        principal: dana,
        resource: 'kyc_case',
        recordId: `case-${i}`,
        action: 'claim',
        requestId,
      });
    }
    await expect(verifyAuditChain(db, 2)).resolves.toEqual({ ok: true, checked: 7 });
  });
});

describe('append-only enforcement', () => {
  it('rejects UPDATE and DELETE on the trail', async () => {
    await writeAuditStandalone({
      kind: 'write',
      principal: dana,
      resource: 'kyc_case',
      recordId: 'case-1',
      action: 'claim',
      requestId,
    });

    await expect(
      db.$executeRawUnsafe(`UPDATE audit_events SET action = 'tampered'`),
    ).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`DELETE FROM audit_events`)).rejects.toThrow(/append-only/);
  });
});

describe('non-write events', () => {
  it('records a denial in its own transaction', async () => {
    await recordDenial({
      principal: dana,
      resource: 'kyc_case',
      action: 'read',
      recordId: 'case-eu-1',
      reason: 'outside your business_unit scope',
      rule: 'scope',
      requestId,
    });

    const row = await db.auditEvent.findFirstOrThrow({ where: { kind: 'auth_denied' } });
    expect(row.actorId).toBe('dana');
    expect(row.reason).toContain('scope');
  });

  it('records revealed fields as a read event', async () => {
    await recordRead({
      principal: dana,
      resource: 'kyc_case',
      recordId: 'case-1',
      fields: ['ssn', 'address'],
      requestId,
    });

    const row = await db.auditEvent.findFirstOrThrow({ where: { kind: 'read' } });
    expect(row.fields.sort()).toEqual(['address', 'ssn']);
  });

  it('writes nothing when a read revealed nothing', async () => {
    const result = await recordRead({
      principal: dana,
      resource: 'kyc_case',
      recordId: 'case-1',
      fields: [],
      requestId,
    });
    expect(result).toBeNull();
    expect(await db.auditEvent.count()).toBe(0);
  });
});
