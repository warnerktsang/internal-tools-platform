/**
 * Demo seed.
 *
 * Fixture rows (principals, payments) are inserted directly, with the require-audit trigger
 * bypassed for that transaction — they were not done by anyone, and inventing an actor for
 * them would put fiction in the compliance trail.
 *
 * The interesting *states*, though, are produced by running real operations as the seeded
 * people: the refund awaiting approval is awaiting it because Sofia actually requested it,
 * and the refund stuck in 'unknown' got there because the processor timed out. So the demo
 * starts two clicks from every moment worth showing, and the audit trail is genuine.
 */
import '@/apps/register';
import { flagConfigResource } from '@/apps/flags/resource';
import { kycCaseResource } from '@/apps/kyc/resource';
import { receiveWebhook } from '@/apps/refunds/processor';
import { refundResource } from '@/apps/refunds/resource';
import { enableAuditBypass } from '@/substrate/audit/bypass';
import { db } from '@/substrate/db';
import { execute } from '@/substrate/operations';
import { create } from '@/substrate/operations/create';
import { DEMO_PRINCIPALS, DEMO_SYSTEM_PRINCIPALS } from '@/seed/principals';
import type { Principal } from '@/substrate/types';

const PAYMENTS = [
  {
    id: 'pay-consumer-1',
    reference: 'PAY-1001',
    businessUnitId: 'bu-consumer',
    customerName: 'Marcus Webb',
    capturedMinor: 24_000,
    processorRef: 'ch_1001',
  },
  {
    id: 'pay-consumer-2',
    reference: 'PAY-1002',
    businessUnitId: 'bu-consumer',
    customerName: 'Lena Ortiz',
    capturedMinor: 50_000,
    processorRef: 'ch_1002',
  },
  {
    id: 'pay-consumer-3',
    reference: 'PAY-1003',
    businessUnitId: 'bu-consumer',
    customerName: 'Theo Baptiste',
    capturedMinor: 9_900,
    processorRef: 'ch_1003',
  },
  {
    id: 'pay-smb-1',
    reference: 'PAY-2001',
    businessUnitId: 'bu-smb',
    customerName: 'Northgate Dental',
    capturedMinor: 180_000,
    processorRef: 'ch_2001',
  },
];

const KYC_CASES = [
  {
    id: 'kyc-1',
    reference: 'KYC-4001',
    businessUnitId: 'bu-consumer',
    customerName: 'Marcus Webb',
    ssn: '412-88-6789',
    dob: new Date('1987-04-12T00:00:00Z'),
    address: '218 Harlow Street, Apt 4B, Portland OR',
    nationality: 'US',
    riskScore: 22,
    slaDays: 1,
    documents: [{ kind: 'identity', filename: 'passport.pdf' }],
  },
  {
    // High risk: approving this one is a compliance decision, not Nadia's.
    id: 'kyc-2',
    reference: 'KYC-4002',
    businessUnitId: 'bu-consumer',
    customerName: 'Lena Ortiz',
    ssn: '523-19-4471',
    dob: new Date('1994-11-02T00:00:00Z'),
    address: '77 Beaumont Road, Austin TX',
    nationality: 'MX',
    riskScore: 81,
    slaDays: 2,
    documents: [
      { kind: 'identity', filename: 'drivers-license.jpg' },
      { kind: 'address', filename: 'utility-bill.pdf' },
    ],
  },
  {
    // No identity document: the approve guard refuses, which is the point of seeding it.
    id: 'kyc-3',
    reference: 'KYC-4003',
    businessUnitId: 'bu-consumer',
    customerName: 'Theo Baptiste',
    ssn: '601-45-2210',
    dob: new Date('1979-01-30T00:00:00Z'),
    address: '9 Rue Mistral, Montreal QC',
    nationality: 'CA',
    riskScore: 64,
    slaDays: 3,
    documents: [{ kind: 'address', filename: 'lease.pdf' }],
  },
  {
    // Another business unit, so a cross-BU denial is one click away.
    id: 'kyc-4',
    reference: 'KYC-5001',
    businessUnitId: 'bu-smb',
    customerName: 'Northgate Dental',
    ssn: '755-32-0098',
    dob: new Date('1968-07-19T00:00:00Z'),
    address: '1400 Fielding Avenue, Columbus OH',
    nationality: 'US',
    riskScore: 35,
    slaDays: 4,
    documents: [{ kind: 'identity', filename: 'incorporation.pdf' }],
  },
];

const FLAGS = [
  {
    id: 'flag-checkout-v2',
    key: 'checkout_v2',
    description: 'New checkout flow. Ramping in production.',
    ownerId: 'usr-sam',
    configs: [
      { environment: 'development', enabled: true, rolloutPct: 100 },
      { environment: 'staging', enabled: true, rolloutPct: 50 },
      { environment: 'production', enabled: true, rolloutPct: 10 },
    ],
  },
  {
    id: 'flag-instant-payouts',
    key: 'instant_payouts',
    description: 'Instant payouts for verified merchants. Off in production.',
    ownerId: 'usr-rel',
    configs: [
      { environment: 'development', enabled: true, rolloutPct: 100 },
      { environment: 'production', enabled: false, rolloutPct: 0 },
    ],
  },
];

async function wipe(): Promise<void> {
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

async function insertFixtures(): Promise<void> {
  await db.$transaction(async (tx) => {
    await enableAuditBypass(tx);

    for (const p of [...DEMO_PRINCIPALS, ...DEMO_SYSTEM_PRINCIPALS]) {
      await tx.principal.create({
        data: {
          id: p.id,
          kind: p.kind,
          email: p.email,
          displayName: p.displayName,
          title: p.title,
          roles: p.roles,
          scopes: p.scopes,
        },
      });
    }

    for (const { slaDays, documents, ...kycCase } of KYC_CASES) {
      await tx.kycCase.create({
        data: { ...kycCase, slaDueAt: new Date(Date.now() + slaDays * 86_400_000) },
      });
      for (const document of documents) {
        await tx.kycDocument.create({
          data: {
            caseId: kycCase.id,
            kind: document.kind,
            filename: document.filename,
            storageKey: `s3://kyc-docs/${kycCase.reference}/${document.filename}`,
          },
        });
      }
    }

    for (const { configs, ...flag } of FLAGS) {
      await tx.flag.create({ data: flag });
      for (const config of configs) {
        await tx.flagConfig.create({ data: { ...config, flagId: flag.id } });
      }
    }

    for (const payment of PAYMENTS) {
      await tx.payment.create({
        data: { ...payment, capturedAt: new Date(Date.now() - 86_400_000) },
      });
    }
  });
}

function principal(id: string): Principal {
  const found = [...DEMO_PRINCIPALS, ...DEMO_SYSTEM_PRINCIPALS].find((p) => p.id === id);
  if (!found) throw new Error(`unknown demo principal '${id}'`);
  return found;
}

async function draftRefund(args: {
  requester: string;
  paymentId: string;
  reference: string;
  amountMinor: number;
  reason: string;
}): Promise<string> {
  const payment = PAYMENTS.find((p) => p.id === args.paymentId)!;
  const result = await create({
    resource: refundResource,
    principal: principal(args.requester),
    data: {
      reference: args.reference,
      paymentId: args.paymentId,
      businessUnitId: payment.businessUnitId,
      amountMinor: args.amountMinor,
      currency: 'USD',
      reason: args.reason,
      requesterId: args.requester,
    },
  });
  if (result.status !== 'ok') throw new Error(`seed: drafting ${args.reference}: ${result.status}`);
  return result.data.id;
}

async function seedRefundScenarios(): Promise<void> {
  // 1. Settled cleanly: requested below the approval threshold, submitted, paid.
  const settled = await draftRefund({
    requester: 'usr-sofia',
    paymentId: 'pay-consumer-3',
    reference: 'RF-2001',
    amountMinor: 2_500,
    reason: 'shipping never arrived',
  });
  await execute({
    resource: refundResource,
    action: 'submit',
    recordId: settled,
    principal: principal('usr-sofia'),
  });

  // 2. Awaiting a finance manager: over the threshold, so Sofia cannot finish it alone.
  const pending = await draftRefund({
    requester: 'usr-sofia',
    paymentId: 'pay-consumer-2',
    reference: 'RF-2002',
    amountMinor: 32_000,
    reason: 'duplicate charge, customer escalated',
  });
  await execute({
    resource: refundResource,
    action: 'submit',
    recordId: pending,
    principal: principal('usr-sofia'),
  });

  // 3. Undetermined outcome: the amount ends in 13, so the processor times out. Left in
  //    'unknown' for a finance manager to reconcile.
  const undetermined = await draftRefund({
    requester: 'usr-sofia',
    paymentId: 'pay-consumer-1',
    reference: 'RF-2003',
    amountMinor: 4_013,
    reason: 'partial goodwill credit',
  });
  await execute({
    resource: refundResource,
    action: 'submit',
    recordId: undetermined,
    principal: principal('usr-sofia'),
  });

  // 4. A hostile webhook the system has already survived: a redelivery of the event that
  //    settled RF-2001, plus one for a refund that does not exist.
  await receiveWebhook({
    externalId: 'evt_seed_dup',
    type: 'refund.succeeded',
    refundId: settled,
    processorRef: 'pi_RF-2001',
  });
  await receiveWebhook({
    externalId: 'evt_seed_dup',
    type: 'refund.succeeded',
    refundId: settled,
    processorRef: 'pi_RF-2001',
  });
}

async function seedKycScenarios(): Promise<void> {
  // A case already under review, claimed by the analyst who owns that business unit, so the
  // decision panel is live on first load.
  const claim = await execute({
    resource: kycCaseResource,
    action: 'claim',
    recordId: 'kyc-1',
    principal: principal('usr-nadia'),
  });
  if (claim.status !== 'ok') throw new Error(`seed: claiming KYC-4001: ${claim.status}`);

  // A rejection parked on compliance: Nadia decided, Omar has to agree, and Nadia cannot
  // approve her own request.
  const claimed = await execute({
    resource: kycCaseResource,
    action: 'claim',
    recordId: 'kyc-3',
    principal: principal('usr-nadia'),
  });
  if (claimed.status !== 'ok') throw new Error(`seed: claiming KYC-4003: ${claimed.status}`);
  const rejection = await execute({
    resource: kycCaseResource,
    action: 'reject',
    recordId: 'kyc-3',
    principal: principal('usr-nadia'),
    payload: { reason: 'address document does not match the applicant; no identity evidence' },
  });
  if (rejection.status !== 'pending') {
    throw new Error(`seed: rejecting KYC-4003 should park for compliance, got ${rejection.status}`);
  }

  await db.kycNote.create({
    data: {
      caseId: 'kyc-2',
      authorId: 'usr-nadia',
      body: 'Sanctions screening returned a weak name match; needs a second pair of eyes.',
    },
  });
}

async function seedFlagScenarios(): Promise<void> {
  const config = async (flagId: string, environment: string): Promise<string> => {
    const row = await db.flagConfig.findFirst({ where: { flagId, environment } });
    if (!row) throw new Error(`seed: no ${flagId} config for ${environment}`);
    return row.id;
  };

  // A staging ramp Sam did himself: in his environments, no approval, published and live.
  const staging = await config('flag-checkout-v2', 'staging');
  const ramp = await execute({
    resource: flagConfigResource,
    action: 'update',
    recordId: staging,
    principal: principal('usr-sam'),
    payload: { enabled: true, rolloutPct: 75, expectedVersion: 1 },
  });
  if (ramp.status !== 'ok') throw new Error(`seed: staging ramp: ${ramp.status}`);

  // A production ramp parked on a second release manager: Renee proposed 10% -> 40%, and
  // she cannot approve her own change.
  const production = await config('flag-checkout-v2', 'production');
  const parked = await execute({
    resource: flagConfigResource,
    action: 'update',
    recordId: production,
    principal: principal('usr-rel'),
    payload: { enabled: true, rolloutPct: 40, expectedVersion: 1 },
  });
  if (parked.status !== 'pending') {
    throw new Error(`seed: production ramp should park, got ${parked.status}`);
  }
}

export type SeedSummary = {
  people: number;
  payments: number;
  refunds: number;
  kycCases: number;
  flagConfigs: number;
  auditEvents: number;
};

/** Wipes and rebuilds the demo. Callable from the CLI and from the reseed route. */
export async function seedDemoData(): Promise<SeedSummary> {
  await wipe();
  await insertFixtures();
  await seedRefundScenarios();
  await seedKycScenarios();
  await seedFlagScenarios();

  const [refunds, kycCases, flagConfigs, auditEvents] = await Promise.all([
    db.refund.count(),
    db.kycCase.count(),
    db.flagConfig.count(),
    db.auditEvent.count(),
  ]);

  return {
    people: DEMO_PRINCIPALS.length,
    payments: PAYMENTS.length,
    refunds,
    kycCases,
    flagConfigs,
    auditEvents,
  };
}
