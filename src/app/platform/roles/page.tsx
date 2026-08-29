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
import { ROLES } from '@/config/roles';
import { currentPrincipal } from '@/substrate/session';

/**
 * Read-only on purpose: roles live in `src/config/roles.ts`, so a grant is a reviewed diff
 * rather than a click in production. This screen is the view of that file.
 */
export default async function RolesPage() {
  const principal = await currentPrincipal();
  if (!principal) return <SelectPrincipal />;

  const permissions = [...new Set(ROLES.flatMap((role) => role.permissions))].sort();

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        tile={false}
        subtitle="Declared in source and resolved by the substrate; no role is editable at runtime."
        meta={
          <>
            <Badge>{ROLES.length} roles</Badge>
            <Badge>{permissions.length} permissions</Badge>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Role</Th>
              <Th>Grant</Th>
              <Th>Description</Th>
              <Th className="text-right">Permissions</Th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map((role) => (
              <tr key={role.name}>
                <Td className="font-medium">{role.name}</Td>
                <Td>
                  <Badge tone={role.grant === 'global' ? 'amber' : 'neutral'}>{role.grant}</Badge>
                </Td>
                <Td className="text-neutral-600">{role.description}</Td>
                <Td className="text-right tabular-nums text-neutral-600">
                  {role.permissions.length}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Permission matrix</CardTitle>
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Permission</Th>
              {ROLES.map((role) => (
                <Th key={role.name} className="px-2 text-center font-mono text-[10px] normal-case tracking-normal">
                  {role.name}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissions.map((permission) => (
              <tr key={permission}>
                <Td>
                  <IdChip>{permission}</IdChip>
                </Td>
                {ROLES.map((role) => (
                  <Td key={role.name} className="px-2 text-center">
                    {role.permissions.includes(permission) ? (
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full bg-accent-600 align-middle"
                        aria-label={`${role.name} has ${permission}`}
                      />
                    ) : (
                      <span className="text-neutral-300" aria-hidden>
                        ·
                      </span>
                    )}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        <CardBody className="text-xs text-neutral-500">
          A permission is <code>resource:action</code>; the same string names the
          transition&apos;s requirement, the audit row and the deny-rule input.
        </CardBody>
      </Card>
    </>
  );
}
