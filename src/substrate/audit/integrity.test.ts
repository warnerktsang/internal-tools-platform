/**
 * These tests are the difference between "apps are supposed to write through the
 * substrate" and "apps cannot write around it". They exercise the deferred constraint
 * trigger directly, using raw domain writes of exactly the kind an app author might
 * reach for on a deadline.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { writeAudit } from '@/substrate/audit';
import { enableAuditBypass } from '@/substrate/audit/bypass';
import { db } from '@/substrate/db';
import { principal } from '@/test/factories';
import { resetDatabase, seedPrincipal } from '@/test/db';

const dana = principal({ id: 'dana', roles: ['kyc_analyst'], scopes: { business_unit: ['us'] } });
const requestId = '00000000-0000-4000-8000-000000000002';

const caseInput = {
  reference: 'KYC-1',
  businessUnitId: 'us',
  customerName: 'Alicia Nunez',
  ssn: '123-45-6789',
  dob: new Date('1987-04-12T00:00:00Z'),
  address: '48 Alameda St, Austin TX',
  nationality: 'US',
  riskScore: 72,
  slaDueAt: new Date('2030-01-01T00:00:00Z'),
};

beforeEach(async () => {
  await resetDatabase();
  await seedPrincipal(dana);
});

describe('no domain mutation without audit in the same transaction', () => {
  it('rejects an insert that skips the transition layer', async () => {
    await expect(db.kycCase.create({ data: caseInput })).rejects.toThrow(
      /has no audit row in this transaction/,
    );
    expect(await db.kycCase.count()).toBe(0);
  });

  it('rejects an update that skips the transition layer', async () => {
    const id = await createAuditedCase();

    await expect(
      db.kycCase.update({ where: { id }, data: { state: 'approved' } }),
    ).rejects.toThrow(/has no audit row in this transaction/);

    const row = await db.kycCase.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe('new');
  });

  it('rejects a delete that skips the transition layer', async () => {
    const id = await createAuditedCase();
    await expect(db.kycCase.delete({ where: { id } })).rejects.toThrow(
      /has no audit row in this transaction/,
    );
    expect(await db.kycCase.count()).toBe(1);
  });

  it('rejects an audit row written for a different record', async () => {
    const id = await createAuditedCase();

    await expect(
      db.$transaction(async (tx) => {
        await tx.kycCase.update({ where: { id }, data: { state: 'in_review' } });
        await writeAudit(tx, {
          kind: 'write',
          principal: dana,
          resource: 'kyc_case',
          recordId: 'some-other-case',
          action: 'claim',
          requestId,
        });
      }),
    ).rejects.toThrow(/has no audit row in this transaction/);
  });

  it('rejects an audit row written under a different resource name', async () => {
    const id = await createAuditedCase();

    await expect(
      db.$transaction(async (tx) => {
        await tx.kycCase.update({ where: { id }, data: { state: 'in_review' } });
        await writeAudit(tx, {
          kind: 'write',
          principal: dana,
          resource: 'refund',
          recordId: id,
          action: 'claim',
          requestId,
        });
      }),
    ).rejects.toThrow(/has no audit row in this transaction/);
  });

  it('accepts a write accompanied by its audit row, in either order', async () => {
    const id = await db.$transaction(async (tx) => {
      // Audit written *after* the domain write: the constraint is deferred to commit, so
      // callers are not forced into an awkward ordering.
      const row = await tx.kycCase.create({ data: caseInput });
      await writeAudit(tx, {
        kind: 'write',
        principal: dana,
        resource: 'kyc_case',
        recordId: row.id,
        action: 'create',
        after: { state: row.state },
        requestId,
      });
      return row.id;
    });

    expect(await db.kycCase.findUnique({ where: { id } })).not.toBeNull();
  });

  it('covers refunds and flag configs as well as kyc cases', async () => {
    const payment = await db.payment.create({
      data: {
        reference: 'PAY-1',
        businessUnitId: 'us',
        customerName: 'Alicia Nunez',
        capturedMinor: 10_000,
        processorRef: 'ch_test_1',
        capturedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    await expect(
      db.refund.create({
        data: {
          reference: 'REF-1',
          paymentId: payment.id,
          businessUnitId: 'us',
          amountMinor: 2_500,
          reason: 'duplicate charge',
          requesterId: dana.id,
        },
      }),
    ).rejects.toThrow(/has no audit row in this transaction/);

    const flag = await db.flag.create({
      data: { key: 'checkout_v2', description: 'new checkout', ownerId: dana.id },
    });
    await expect(
      db.flagConfig.create({ data: { flagId: flag.id, environment: 'production' } }),
    ).rejects.toThrow(/has no audit row in this transaction/);
  });

  it('lets the seeder load fixtures without inventing audit rows', async () => {
    const id = await db.$transaction(async (tx) => {
      await enableAuditBypass(tx);
      const row = await tx.kycCase.create({ data: caseInput });
      return row.id;
    });

    expect(await db.kycCase.findUnique({ where: { id } })).not.toBeNull();
    expect(await db.auditEvent.count()).toBe(0);
  });

  it('does not leak the bypass beyond the transaction that set it', async () => {
    await db.$transaction(async (tx) => {
      await enableAuditBypass(tx);
      await tx.kycCase.create({ data: caseInput });
    });

    await expect(
      db.kycCase.create({ data: { ...caseInput, reference: 'KYC-2' } }),
    ).rejects.toThrow(/has no audit row in this transaction/);
  });
});

async function createAuditedCase(): Promise<string> {
  return db.$transaction(async (tx) => {
    const row = await tx.kycCase.create({ data: caseInput });
    await writeAudit(tx, {
      kind: 'write',
      principal: dana,
      resource: 'kyc_case',
      recordId: row.id,
      action: 'create',
      after: { state: row.state },
      requestId,
    });
    return row.id;
  });
}
