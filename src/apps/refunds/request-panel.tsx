import { requestRefund } from '@/apps/refunds/actions';
import { APPROVAL_THRESHOLD_MINOR } from '@/apps/refunds/resource';
import { Button, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { formatMoneyMinor } from '@/lib/utils';

/**
 * Rendered on a payment's detail screen. The form collects only what the substrate cannot
 * infer; the amount ceiling, the scope and the approval threshold are all enforced on the
 * server, so nothing here is load-bearing for correctness.
 */
export function RequestRefundPanel({ recordId }: { recordId: string; data: Record<string, unknown> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Request a refund</CardTitle>
      </CardHeader>
      <CardBody>
        <form action={requestRefund} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="paymentId" value={recordId} />
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Amount
            <input
              name="amount"
              placeholder="19.99"
              className="w-32 rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-neutral-500">
            Reason
            <input
              name="reason"
              placeholder="duplicate charge"
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900"
            />
          </label>
          <Button type="submit">Draft refund</Button>
        </form>
        <p className="mt-3 text-xs text-neutral-500">
          Refunds above {formatMoneyMinor(APPROVAL_THRESHOLD_MINOR)} need a finance manager&apos;s
          approval, and the requester cannot be that approver.
        </p>
      </CardBody>
    </Card>
  );
}
