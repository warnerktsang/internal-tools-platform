import '@/apps/register';
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
import { DENY_RULES } from '@/config/roles';
import { registeredResources } from '@/substrate/registry';
import { currentPrincipal } from '@/substrate/session';

const SENSITIVITY_TONE = {
  public: 'neutral',
  sensitive: 'amber',
  restricted: 'red',
} as const;

export default async function PoliciesPage() {
  const principal = await currentPrincipal();
  if (!principal) return <SelectPrincipal />;

  const resources = registeredResources();
  const approvals = resources.flatMap((entry) =>
    Object.values(entry.def.approvals ?? {}).map((policy) => ({ resource: entry.def, policy })),
  );
  const guardedFields = resources.flatMap((entry) =>
    Object.entries(entry.def.fields)
      .filter(([, rule]) => rule.sensitivity !== 'public')
      .map(([field, rule]) => ({ resource: entry.def, field, rule })),
  );

  return (
    <>
      <PageHeader
        title="Deny rules"
        tile={false}
        subtitle="Evaluated after permissions, and deny always wins — the rule an additive-only role model cannot express."
        meta={<Badge tone="red">{DENY_RULES.length} active</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {DENY_RULES.map((rule) => (
          <Card key={rule.name}>
            <CardHeader>
              <CardTitle className="font-mono text-xs">{rule.name}</CardTitle>
            </CardHeader>
            <CardBody className="text-sm text-neutral-600">{rule.reason}</CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Approval policies</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Policy</Th>
              <Th>Resource</Th>
              <Th className="text-right">Approvers</Th>
              <Th>Eligible roles</Th>
              <Th>Separation of duties</Th>
            </tr>
          </thead>
          <tbody>
            {approvals.map(({ resource, policy }) => (
              <tr key={`${resource.name}.${policy.name}`}>
                <Td className="font-medium">{policy.name}</Td>
                <Td className="text-neutral-600">{resource.label}</Td>
                <Td className="text-right tabular-nums">
                  {policy.rules.map((rule) => rule.approvers).join(' / ')}
                </Td>
                <Td className="text-neutral-600">
                  {[...new Set(policy.rules.flatMap((rule) => rule.eligibleRoles ?? []))].join(
                    ', ',
                  ) || 'any approver'}
                </Td>
                <Td className="text-neutral-600">
                  {[
                    policy.exclusions.excludeRequester ? 'requester excluded' : null,
                    policy.exclusions.excludeSelf ? 'one slot per person' : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <CardBody className="text-xs text-neutral-500">
          A rule applies conditionally (amount thresholds, environment), so a policy can require
          different numbers of approvers for different records.
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Field policy</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Field</Th>
              <Th>Sensitivity</Th>
              <Th>Mask</Th>
              <Th>Reveal requires</Th>
            </tr>
          </thead>
          <tbody>
            {guardedFields.map(({ resource, field, rule }) => (
              <tr key={`${resource.name}.${field}`}>
                <Td>
                  <IdChip>
                    {resource.name}.{field}
                  </IdChip>
                </Td>
                <Td>
                  <Badge tone={SENSITIVITY_TONE[rule.sensitivity]}>{rule.sensitivity}</Badge>
                </Td>
                <Td className="text-neutral-600">{rule.mask}</Td>
                <Td>
                  <IdChip>{rule.revealPermission}</IdChip>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <CardBody className="text-xs text-neutral-500">
          Masking happens server-side during projection: an unrevealed value never reaches the
          browser, and every reveal writes an audit row naming the fields.
        </CardBody>
      </Card>
    </>
  );
}
