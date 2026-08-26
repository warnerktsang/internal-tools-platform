import { notFound } from 'next/navigation';
import '@/apps/register';
import { OperationBanner } from '@/components/operation-status';
import { RecordDetail } from '@/components/record-views';
import { SelectPrincipal } from '@/components/select-principal';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { resourceByPath } from '@/substrate/registry';
import { currentPrincipal } from '@/substrate/session';
import type { OperationStatus } from '@/substrate/types';
import { detailView } from '@/substrate/views';

const STATUSES: OperationStatus[] = ['ok', 'pending', 'denied', 'invalid', 'unknown'];

function asStatus(value: string | undefined): OperationStatus | null {
  return STATUSES.find((status) => status === value) ?? null;
}

export default async function ResourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ resource: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ resource, id }, query] = await Promise.all([params, searchParams]);
  const entry = resourceByPath(resource);
  if (!entry) notFound();

  const principal = await currentPrincipal();
  if (!principal) return <SelectPrincipal />;

  const revealParam = typeof query.reveal === 'string' ? query.reveal : '';
  const reveal = revealParam.split(',').filter(Boolean);

  const view = await detailView(entry, id, principal, { reveal });
  if (view.status === 'missing') notFound();

  const status = asStatus(typeof query.status === 'string' ? query.status : undefined);
  const message = typeof query.message === 'string' ? query.message : undefined;
  const reference = typeof query.reference === 'string' ? query.reference : undefined;

  return (
    <div className="space-y-6">
      {status ? <OperationBanner status={status} message={message} reference={reference} /> : null}

      {view.status === 'denied' ? (
        <Card>
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-neutral-600">
            {view.reason}. The attempt was recorded in the audit trail.
          </CardBody>
        </Card>
      ) : (
        <RecordDetail entry={entry} recordId={id} view={view} revealed={reveal} />
      )}
    </div>
  );
}
