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
import { receiveWebhook } from '@/apps/refunds/processor';
import { refundResource } from '@/apps/refunds/resource';
import { enableAuditBypass } from '@/substrate/audit/bypass';
import { db } from '@/substrate/db';
import { runEffects } from '@/substrate/effects';
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
  await runEffects();

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
  await runEffects();

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

  // 5. A draft in the other business unit, so cross-scope denial is one click away.
  await draftRefund({
    requester: 'usr-dan',
    paymentId: 'pay-smb-1',
    reference: 'RF-3001',
    amountMinor: 45_000,
    reason: 'contract cancelled mid-term',
  });
}

async function main(): Promise<void> {
  await wipe();
  await insertFixtures();
  await seedRefundScenarios();

  const [refunds, events] = await Promise.all([db.refund.count(), db.auditEvent.count()]);
  console.log(`seeded ${DEMO_PRINCIPALS.length} people, ${PAYMENTS.length} payments, ${refunds} refunds`);
  console.log(`${events} audit events written by real operations`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
