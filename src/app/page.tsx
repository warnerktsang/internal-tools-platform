import Link from 'next/link';
import '@/apps/register';
import { ModelDiagram } from '@/components/model-diagram';
import { SelectPrincipal } from '@/components/select-principal';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { DENY_RULES, ROLES } from '@/config/roles';
import { registeredResources } from '@/substrate/registry';
import { currentPrincipal } from '@/substrate/session';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-2xl font-semibold tracking-tight text-neutral-900">{value}</div>
      <div className="mt-0.5 text-xs text-neutral-500">{label}</div>
    </div>
  );
}

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
  const permissions = new Set(ROLES.flatMap((role) => role.permissions));

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

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Resource types" value={resources.length} />
        <Stat label="Roles" value={ROLES.length} />
        <Stat label="Permissions" value={permissions.size} />
        <Stat label="Deny rules" value={DENY_RULES.length} />
      </div>

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

      <Card>
        <CardHeader>
          <CardTitle>The objects every app is built from</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <ModelDiagram />
          <p className="text-sm text-neutral-600">
            Screens, navigation, authorization, masking and history are derived from those{' '}
            {resources.length} declarations. An app contributes a resource definition; the
            substrate contributes everything else.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
