import { AuditTimeline, Denied } from '@/components/record-views';
import { SelectPrincipal } from '@/components/select-principal';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/primitives';
import { verifyAuditChain } from '@/substrate/audit';
import { hasPermission } from '@/substrate/authz';
import { db } from '@/substrate/db';
import { currentPrincipal } from '@/substrate/session';

/** One trail for every app — the claim that per-app audit tables cannot make. */
export default async function AuditPage() {
  const principal = await currentPrincipal();
  if (!principal) return <SelectPrincipal />;

  if (!hasPermission(principal, 'audit_event:read')) {
    return <Denied reason="Reading the audit trail requires audit_event:read." />;
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
      <PageHeader
        title="Audit logs"
        tile={false}
        subtitle="One trail for every app, written in the same transaction as the change it records"
        meta={
          verification.ok ? (
            <Badge tone="green">hash chain verified · {verification.checked} events</Badge>
          ) : (
            <Badge tone="red">
              {verification.problem} at seq {verification.brokenAtSeq}
            </Badge>
          )
        }
      />

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
