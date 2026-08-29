import Link from 'next/link';
import '@/apps/register';
import { ModelDiagram } from '@/components/platform/model-diagram';
import { SelectPrincipal } from '@/components/select-principal';
import { PageHeader } from '@/components/shell/page-header';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  IdChip,
  Table,
  Td,
  Th,
} from '@/components/ui/primitives';
import { registeredResources } from '@/substrate/registry';
import { currentPrincipal } from '@/substrate/session';

export default async function ResourceTypesPage() {
  const principal = await currentPrincipal();
  if (!principal) return <SelectPrincipal />;

  const resources = registeredResources();

  return (
    <>
      <PageHeader
        title="Resource types"
        tile={false}
        subtitle="Every screen, permission check, mask and audit row below is derived from these declarations."
        meta={<Badge>{resources.length} registered</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>Object model</CardTitle>
        </CardHeader>
        <CardBody>
          <ModelDiagram />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered types</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>App</Th>
              <Th>Scope</Th>
              <Th className="text-right">States</Th>
              <Th className="text-right">Transitions</Th>
              <Th className="text-right">Guarded fields</Th>
            </tr>
          </thead>
          <tbody>
            {resources.map((entry) => (
              <tr key={entry.def.name}>
                <Td>
                  <Link href={`/r/${entry.path}`} className="font-medium hover:underline">
                    {entry.def.label}
                  </Link>
                  <div className="mt-0.5">
                    <IdChip>{entry.def.name}</IdChip>
                  </div>
                </Td>
                <Td className="text-neutral-600">{entry.app}</Td>
                <Td className="text-neutral-600">{entry.def.scope?.dimension ?? 'global'}</Td>
                <Td className="text-right tabular-nums">{entry.def.machine.states.length}</Td>
                <Td className="text-right tabular-nums">{entry.def.machine.transitions.length}</Td>
                <Td className="text-right tabular-nums">{Object.keys(entry.def.fields).length}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {resources.map((entry) => (
        <Card key={entry.def.name}>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{entry.def.label} transitions</CardTitle>
            <span className="text-xs text-neutral-500">
              initial state: <code>{entry.def.machine.initial}</code>
            </span>
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>Action</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>Permission</Th>
                <Th>Approval</Th>
                <Th>Effect</Th>
              </tr>
            </thead>
            <tbody>
              {entry.def.machine.transitions.map((transition) => (
                <tr key={transition.action}>
                  <Td className="font-medium">{transition.action}</Td>
                  <Td className="text-neutral-600">{transition.from.join(', ')}</Td>
                  <Td className="text-neutral-600">{transition.to}</Td>
                  <Td>
                    <IdChip>{transition.permission}</IdChip>
                  </Td>
                  <Td>
                    {transition.requiresApproval ? (
                      <Badge tone="amber">{transition.requiresApproval}</Badge>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </Td>
                  <Td>
                    {transition.effect ? (
                      <Badge tone="blue">enqueued</Badge>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ))}
    </>
  );
}
