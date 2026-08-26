/**
 * The one thing refunds needs that generation cannot supply: creating a refund against a
 * payment. It is still thin — parse, then hand to the substrate's `create()`, which
 * authorizes, runs the cumulative-amount guard and audits.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseAmountToMinor } from '@/apps/refunds/money';
import { refundResource } from '@/apps/refunds/resource';
import { db } from '@/substrate/db';
import { create } from '@/substrate/operations/create';
import { requirePrincipal } from '@/substrate/session';

export async function requestRefund(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const paymentId = String(formData.get('paymentId') ?? '');
  const back = `/r/payments/${paymentId}`;

  const amount = parseAmountToMinor(String(formData.get('amount') ?? ''));
  if (!amount.ok) {
    redirect(`${back}?status=invalid&message=${encodeURIComponent(amount.reason)}`);
  }

  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) redirect(`${back}?status=invalid&message=${encodeURIComponent('unknown payment')}`);

  const result = await create({
    resource: refundResource,
    principal,
    data: {
      reference: `RF-${Date.now().toString(36).toUpperCase()}`,
      paymentId,
      // Inherited from the payment: a refund is scoped wherever its payment is, and the
      // requester does not get to choose.
      businessUnitId: payment.businessUnitId,
      amountMinor: amount.minor,
      currency: payment.currency,
      reason: String(formData.get('reason') ?? '').trim() || 'not specified',
      requesterId: principal.id,
    },
  });

  revalidatePath(back);

  if (result.status !== 'ok') {
    const message = 'reason' in result ? result.reason : result.status;
    redirect(`${back}?status=${result.status}&message=${encodeURIComponent(message)}`);
  }
  redirect(`/r/refunds/${result.data.id}?status=ok&message=${encodeURIComponent('refund drafted')}`);
}
