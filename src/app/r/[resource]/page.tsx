import { notFound } from 'next/navigation';
import { RecordList } from '@/components/record-views';
import '@/apps/register';
import { resourceByPath } from '@/substrate/registry';
import { currentPrincipal } from '@/substrate/session';
import { listView } from '@/substrate/views';
import { SelectPrincipal } from '@/components/select-principal';

export default async function ResourceListPage({
  params,
  searchParams,
}: {
  params: Promise<{ resource: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ resource }, query] = await Promise.all([params, searchParams]);
  const entry = resourceByPath(resource);
  if (!entry) notFound();

  const principal = await currentPrincipal();
  if (!principal) return <SelectPrincipal />;

  return (
    <RecordList
      entry={entry}
      view={await listView(entry, principal)}
      query={typeof query.q === 'string' ? query.q : ''}
    />
  );
}
