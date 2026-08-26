import { db } from '@/substrate/db';
import type { Principal } from '@/substrate/types';

/**
 * Integration tests run against a real Postgres, because the guarantees under test are
 * enforced by Postgres: the append-only trigger, the require-audit constraint trigger,
 * row locks and transaction ids do not exist in a mock.
 */
export async function resetDatabase(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_events, approvals, approval_requests, idempotency_records, effects,
      kyc_notes, kyc_documents, kyc_cases,
      processor_events, refunds, payments,
      flag_configs, flags,
      principals
    RESTART IDENTITY CASCADE
  `);
}

export async function seedPrincipal(principal: Principal): Promise<Principal> {
  await db.principal.upsert({
    where: { id: principal.id },
    create: {
      id: principal.id,
      kind: principal.kind,
      email: principal.email,
      displayName: principal.displayName,
      title: principal.title,
      roles: principal.roles,
      scopes: principal.scopes,
    },
    update: {},
  });
  return principal;
}

export { principal } from '@/test/factories';
