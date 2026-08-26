/**
 * The five outcomes, rendered distinctly.
 *
 * Collapsing them into one red toast is the failure this whole design is arguing against:
 * "you may not" (authority), "that is not valid" (domain), "someone else must agree"
 * (governance) and "we do not know whether the money moved" (external) are four different
 * situations requiring four different human responses.
 */
import { Badge, type BadgeTone } from '@/components/ui/primitives';
import type { OperationStatus as Status } from '@/substrate/types';

const PRESENTATION: Record<Status, { label: string; tone: BadgeTone; hint: string }> = {
  ok: { label: 'Applied', tone: 'green', hint: 'The change is committed and audited.' },
  pending: {
    label: 'Awaiting approval',
    tone: 'amber',
    hint: 'Nothing has changed yet. The reviewed payload is applied when approval lands.',
  },
  denied: { label: 'Denied', tone: 'red', hint: 'You do not hold the authority for this action.' },
  invalid: { label: 'Invalid', tone: 'slate', hint: 'The action is not valid for this record.' },
  unknown: {
    label: 'Outcome unknown',
    tone: 'blue',
    hint: 'The external call did not report back. It is not a failure — it is undetermined, and reconciliation will settle it.',
  },
};

export function StatusBadge({ status }: { status: Status }) {
  const { label, tone } = PRESENTATION[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function OperationBanner({
  status,
  message,
  reference,
}: {
  status: Status;
  message?: string;
  reference?: string;
}) {
  const { hint } = PRESENTATION[status];
  return (
    <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <StatusBadge status={status} />
        {message ? <span className="text-sm text-neutral-800">{message}</span> : null}
      </div>
      <p className="text-xs text-neutral-500">{hint}</p>
      {reference ? <p className="font-mono text-xs text-neutral-500">{reference}</p> : null}
    </div>
  );
}
