import Link from 'next/link';
import '@/apps/register';
import { SelectPrincipal } from '@/components/select-principal';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { registeredResources } from '@/substrate/registry';
import { currentPrincipal } from '@/substrate/session';

export default async function HomePage() {
  const principal = await currentPrincipal();
  if (!principal) return <SelectPrincipal />;

  const resources = registeredResources();
  // One card per app, not per resource: refunds registers both payments and refunds under the
  // same app name, and a card each made the app look listed twice.
  const apps = new Map<string, typeof resources>();
  for (const entry of resources) {
    apps.set(entry.app, [...(apps.get(entry.app) ?? []), entry]);
  }

  return (
    <>
      <PageHeader
        title={principal.displayName}
        tile
        subtitle={principal.title ?? principal.email ?? 'Acting as this principal'}
        meta={principal.roles.map((role) => (
          <Badge key={role} tone="blue">
            {role}
          </Badge>
        ))}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {[...apps].map(([app, entries]) => (
          <Card key={app}>
            <CardHeader>
              <CardTitle>{app}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {entries.map((entry) => (
                <div key={entry.path}>
                  <Link href={`/r/${entry.path}`} className="font-medium text-accent-700 hover:underline">
                    {entry.nav}
                  </Link>
                  <p className="mt-1 text-xs text-neutral-500">
                    scope: {entry.def.scope?.dimension ?? 'global'} · states:{' '}
                    {entry.def.machine.states.join(', ')}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
