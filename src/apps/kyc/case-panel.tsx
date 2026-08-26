import { decideCase } from '@/apps/kyc/actions';
import { HIGH_RISK_SCORE } from '@/apps/kyc/resource';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { db } from '@/substrate/db';
import type { AvailableAction } from '@/substrate/views';

const DECISIONS = ['approve', 'reject', 'escalate', 'request_info'] as const;

/**
 * Rendered on a case's detail screen. Availability is passed in — computed on the server by
 * the same code that renders the generated buttons — so this panel presents authority
 * decisions rather than making any.
 */
export async function CaseDecisionPanel({
  recordId,
  data,
  actions,
}: {
  recordId: string;
  data: Record<string, unknown>;
  actions: AvailableAction[];
}) {
  const documents = await db.kycDocument.findMany({
    where: { caseId: recordId },
    orderBy: { uploadedAt: 'asc' },
  });
  const decisions = DECISIONS.map((name) => actions.find((a) => a.action === name)).filter(
    (action): action is AvailableAction => action !== undefined,
  );
  const highRisk = Number(data.riskScore) >= HIGH_RISK_SCORE;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Decide this case</CardTitle>
        <Badge tone={highRisk ? 'amber' : 'neutral'}>
          risk {String(data.riskScore)}
          {highRisk ? ' · high' : ''}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="text-sm">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Identity evidence on file
          </div>
          {documents.length === 0 ? (
            <p className="text-neutral-500">
              None. A case cannot be approved without an identity document.
            </p>
          ) : (
            <ul className="list-inside list-disc text-neutral-700">
              {documents.map((document) => (
                <li key={document.id}>
                  {document.filename} <span className="text-neutral-500">({document.kind})</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form action={decideCase} className="space-y-3">
          <input type="hidden" name="recordId" value={recordId} />
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Reason (kept with the case, read by the approver and the auditor)
            <textarea
              name="reason"
              rows={2}
              placeholder="documents match the applicant; sanctions screening clear"
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {decisions.map((action) => (
              <Button
                key={action.action}
                type="submit"
                name="action"
                value={action.action}
                variant={action.action === 'reject' ? 'danger' : 'outline'}
                disabled={!action.available}
                title={action.reason ?? undefined}
              >
                {action.action.replace(/_/g, ' ')}
                {action.requiresApproval ? ' (needs approval)' : ''}
              </Button>
            ))}
          </div>
        </form>

        <p className="text-xs text-neutral-500">
          Rejection always needs a compliance officer. Approval needs one too at risk{' '}
          {HIGH_RISK_SCORE} and above. In both cases the analyst who asked cannot be the one who
          agrees.
        </p>
      </CardBody>
    </Card>
  );
}
