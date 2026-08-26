import { AuditTimeline } from '@/components/record-views';
import { SelectPrincipal } from '@/components/select-principal';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { verifyAuditChain } from '@/substrate/audit';
import { hasPermission } from '@/substrate/authz';
import { db } from '@/substrate/db';
import { currentPrincipal } from '@/substrate/session';

/** One trail for every app — the claim that per-app audit tables cannot make. */
export default async function AuditPage() {
  const principal = await currentPrincipal();
  if (!principal) return <SelectPrincipal />;

  if (!hasPermission(principal, 'audit_event:read')) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
        </CardHeader>
        <CardBody className="text-sm text-neutral-600">
          Reading the audit trail requires <code>audit_event:read</code>.
        </CardBody>
      </Card>
    );
  }

  const [events, verification] = await Promise.all([
    db.auditEvent.findMany({
      orderBy: { seq: 'desc' },
      take: 100,
      select: {
        seq: true,
        createdAt: true,
        kind: true,
        action: true,
        actorId: true,
        actorRoles: true,
        fields: true,
        reason: true,
        resource: true,
      },
    }),
    verifyAuditChain(),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Hash chain</CardTitle>
          {verification.ok ? (
            <Badge tone="green">verified · {verification.checked} events</Badge>
          ) : (
            <Badge tone="red">
              {verification.problem} at seq {verification.brokenAtSeq}
            </Badge>
          )}
        </CardHeader>
        <CardBody className="text-xs text-neutral-500">
          Each event hashes its predecessor, so an edited or deleted row is detectable rather than
          merely discouraged.
        </CardBody>
      </Card>

      <AuditTimeline
        entries={events.map(({ createdAt, seq, resource, ...event }) => ({
          ...event,
          seq: seq.toString(),
          at: createdAt,
          action: `${resource}:${event.action}`,
        }))}
      />
    </div>
  );
}
