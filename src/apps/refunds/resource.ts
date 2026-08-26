/**
 * The refunds app: everything here is domain meaning, and nothing here is machinery.
 *
 * What the app owns and the substrate deliberately does not:
 *   - money is integer minor units, everywhere, including the UI and any export;
 *   - a refund may never push the payment's cumulative refunded total past what was
 *     captured — checked under a lock on the payment row, since two concurrent requests
 *     for 60% of a payment are individually valid and jointly wrong;
 *   - a timeout is not a failure: 'unknown' is a real state a human has to resolve;
 *   - the approval threshold ($100) is a business decision, declared as data.
 */
import { defineResource } from '@/substrate/resource';
import { lockRow } from '@/substrate/operations/create';
import { invalid } from '@/substrate/types';
import type { Tx } from '@/substrate/types';

export type RefundRow = {
  id: string;
  reference: string;
  paymentId: string;
  paymentRef: string | null;
  customerName: string | null;
  businessUnitId: string;
  amountMinor: number;
  currency: string;
  state: string;
  reason: string;
  requesterId: string;
  processorRef: string | null;
  unknownSince: Date | null;
};

/** Approval is required above this; below it, a support agent acts alone. */
export const APPROVAL_THRESHOLD_MINOR = 10_000;

/**
 * The cumulative invariant. Locks the payment first so that concurrent requests serialize
 * on it; 'unknown' counts against the total, because a refund that may have succeeded must
 * not license a second one.
 */
async function assertWithinCapturedAmount(
  tx: Tx,
  args: { paymentId: string; amountMinor: number; currency: string; excludeRefundId?: string },
): Promise<void> {
  await lockRow(tx, 'payments', args.paymentId);

  const payment = await tx.payment.findUnique({ where: { id: args.paymentId } });
  if (!payment) invalid('payment does not exist', 'paymentId');
  if (payment.currency !== args.currency) {
    invalid(`payment is in ${payment.currency}; refund is in ${args.currency}`, 'currency');
  }
  if (args.amountMinor <= 0) invalid('refund amount must be positive', 'amountMinor');

  const committed = await tx.refund.aggregate({
    where: {
      paymentId: args.paymentId,
      id: args.excludeRefundId ? { not: args.excludeRefundId } : undefined,
      state: { in: ['submitted', 'succeeded', 'unknown'] },
    },
    _sum: { amountMinor: true },
  });
  const already = committed._sum.amountMinor ?? 0;

  if (already + args.amountMinor > payment.capturedMinor) {
    invalid(
      `refunding ${args.amountMinor} would exceed the captured amount: ${already} of ${payment.capturedMinor} is already refunded or in flight`,
      'amountMinor',
    );
  }
}

export const refundResource = defineResource<RefundRow>({
  name: 'refund',
  table: 'refunds',
  label: 'Refund',
  delegate: (tx) => tx.refund,
  scope: { dimension: 'business_unit', field: 'businessUnitId' },
  fields: {},
  creation: {
    permission: 'refund:request',
    guard: async ({ data, tx }) =>
      assertWithinCapturedAmount(tx, {
        paymentId: String(data.paymentId),
        amountMinor: Number(data.amountMinor),
        currency: String(data.currency ?? 'USD'),
      }),
    // Who was refunded and against which payment, copied onto the refund at request time:
    // the list and the audit trail then read on their own, and a later edit to the payment
    // cannot rewrite what the refund was requested against.
    derive: async ({ data, tx }) => {
      const payment = await tx.payment.findUnique({ where: { id: String(data.paymentId) } });
      return { paymentRef: payment?.reference ?? null, customerName: payment?.customerName ?? null };
    },
  },
  machine: {
    initial: 'draft',
    states: ['draft', 'submitted', 'succeeded', 'failed', 'unknown', 'rejected'],
    transitions: [
      {
        action: 'submit',
        from: ['draft'],
        to: 'submitted',
        permission: 'refund:request',
        requiresApproval: 'threshold',
        // Re-checked at submit *and* again when an approval replays it, because the world
        // moved while the request sat in someone's queue.
        guard: async ({ record, tx }) =>
          assertWithinCapturedAmount(tx, {
            paymentId: record.paymentId,
            amountMinor: record.amountMinor,
            currency: record.currency,
            excludeRefundId: record.id,
          }),
        effect: ({ record }) => ({
          port: 'processor',
          operation: 'refund',
          payload: {
            refundId: record.id,
            reference: record.reference,
            amountMinor: record.amountMinor,
            currency: record.currency,
          },
          // Stable across retries: the processor must see one refund, however many times
          // the worker calls it.
          idempotencyKey: `refund:${record.id}`,
        }),
      },
      {
        action: 'settle',
        from: ['submitted', 'unknown'],
        to: 'succeeded',
        permission: 'refund:settle',
        apply: ({ payload }) => ({
          processorRef: payload.processorRef ?? null,
          unknownSince: null,
        }),
      },
      {
        action: 'fail',
        from: ['submitted', 'unknown'],
        to: 'failed',
        permission: 'refund:settle',
        apply: () => ({ unknownSince: null }),
      },
      {
        /** The honest outcome of a timeout: the money may or may not have moved. */
        action: 'mark_unknown',
        from: ['submitted'],
        to: 'unknown',
        permission: 'refund:settle',
        apply: () => ({ unknownSince: new Date() }),
      },
      {
        /**
         * Reconciliation asks the processor what actually happened. It stays in 'unknown'
         * and enqueues a lookup; the answer settles the refund through `settle`/`fail`.
         */
        action: 'reconcile',
        from: ['unknown'],
        to: 'unknown',
        permission: 'refund:reconcile',
        effect: ({ record }) => ({
          port: 'processor',
          operation: 'lookup',
          payload: { refundId: record.id, reference: record.reference },
          idempotencyKey: `lookup:${record.id}:${record.unknownSince?.toISOString() ?? 'na'}`,
        }),
      },
      {
        action: 'reject',
        from: ['draft'],
        to: 'rejected',
        permission: 'refund:request',
      },
    ],
  },
  approvals: {
    threshold: {
      name: 'threshold',
      rules: [
        {
          appliesWhen: (record) => Number(record.amountMinor) > APPROVAL_THRESHOLD_MINOR,
          approvers: 1,
          eligibleRoles: ['finance_manager'],
        },
      ],
      // The requester cannot approve their own refund, however senior they are.
      exclusions: { excludeRequester: true },
    },
  },
});

/** Payments are read-only here: they arrive from the processor, nobody edits them. */
export const paymentResource = defineResource<{ id: string; businessUnitId: string }>({
  name: 'payment',
  table: 'payments',
  label: 'Payment',
  delegate: (tx) => tx.payment,
  scope: { dimension: 'business_unit', field: 'businessUnitId' },
  fields: {},
  machine: { initial: 'captured', states: ['captured'], transitions: [] },
});
