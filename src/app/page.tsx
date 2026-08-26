import Link from 'next/link';
import '@/apps/register';
import { SelectPrincipal } from '@/components/select-principal';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { registeredResources } from '@/substrate/registry';
import { currentPrincipal } from '@/substrate/session';

export default async function HomePage() {
  const principal = await currentPrincipal();
  if (!principal) return <SelectPrincipal />;

  const resources = registeredResources();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Acting as {principal.displayName}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-1">
            {principal.roles.map((role) => (
              <Badge key={role} tone="blue">
                {role}
              </Badge>
            ))}
          </div>
          <p className="text-neutral-600">
            {resources.length} registered resource{resources.length === 1 ? '' : 's'}. Screens,
            navigation, authorization, masking and history are derived from those declarations.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {resources.map((entry) => (
          <Card key={entry.path}>
            <CardHeader>
              <CardTitle>{entry.app}</CardTitle>
            </CardHeader>
            <CardBody className="text-sm">
              <Link href={`/r/${entry.path}`} className="underline">
                {entry.nav}
              </Link>
              <p className="mt-1 text-xs text-neutral-500">
                scope: {entry.def.scope?.dimension ?? 'global'} · states:{' '}
                {entry.def.machine.states.join(', ')}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>

      {resources.length === 0 ? (
        <Card>
          <CardBody className="text-sm text-neutral-600">
            No resources registered yet — the three tools declare themselves in the PRs after this
            one. The shell, switcher, generated screens and audit view are already wired to whatever
            registers.
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
