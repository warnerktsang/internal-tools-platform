import { notFound } from 'next/navigation';
import { RecordList } from '@/components/record-views';
import '@/apps/register';
import { resourceByPath } from '@/substrate/registry';
import { currentPrincipal } from '@/substrate/session';
import { listView } from '@/substrate/views';
import { SelectPrincipal } from '@/components/select-principal';

export default async function ResourceListPage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const { resource } = await params;
  const entry = resourceByPath(resource);
  if (!entry) notFound();

  const principal = await currentPrincipal();
  if (!principal) return <SelectPrincipal />;

  return <RecordList entry={entry} view={await listView(entry, principal)} />;
}
