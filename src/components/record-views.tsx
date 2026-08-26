import Link from 'next/link';
import { drainEffects, decideApproval, runAction } from '@/app/actions';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Table, Td, Th } from '@/components/ui/primitives';
import { formatDate, formatMoneyMinor } from '@/lib/utils';
import type { Column, RegisteredResource } from '@/substrate/registry';
import type { AvailableAction, DetailView, HistoryEntry, ListView, ViewRow } from '@/substrate/views';

function cell(row: ViewRow, column: Column) {
  const value = row.data[column.field];
  if (value === null || value === undefined) return '—';
  switch (column.format) {
    case 'money_minor':
      return formatMoneyMinor(value);
    case 'date':
      return formatDate(value);
    case 'state':
      return <Badge tone="neutral">{String(value)}</Badge>;
    default:
      return String(value);
  }
}

export function RecordList({ entry, view }: { entry: RegisteredResource; view: ListView }) {
  if (view.status === 'denied') {
    return (
      <Card>
        <CardBody className="text-sm text-neutral-600">{view.reason}</CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{entry.nav}</CardTitle>
        <span className="text-xs text-neutral-500">
          {view.total} visible
          {view.scope && view.scope.mode === 'scoped'
            ? ` · scoped to ${view.scope.dimension} ${view.scope.values?.join(', ')}`
            : view.scope
              ? ` · ${view.scope.mode} ${view.scope.dimension} access`
              : ''}
        </span>
      </CardHeader>
      <Table>
        <thead>
          <tr>
            {entry.columns.map((column) => (
              <Th key={column.field}>{column.label}</Th>
            ))}
            <Th>{null}</Th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={row.id}>
              {entry.columns.map((column) => (
                <Td key={column.field}>{cell(row, column)}</Td>
              ))}
              <Td className="text-right">
                <Link href={`/r/${entry.path}/${row.id}`} className="text-sm underline">
                  Open
                </Link>
              </Td>
            </tr>
          ))}
          {view.rows.length === 0 ? (
            <tr>
              <Td colSpan={entry.columns.length + 1} className="text-sm text-neutral-500">
                Nothing in scope.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </Card>
  );
}

function ActionButton({
  entry,
  recordId,
  action,
}: {
  entry: RegisteredResource;
  recordId: string;
  action: AvailableAction;
}) {
  return (
    <form action={runAction} className="inline">
      <input type="hidden" name="resource" value={entry.def.name} />
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="action" value={action.action} />
      <Button
        type="submit"
        variant="outline"
        disabled={!action.available}
        title={action.reason ?? undefined}
      >
        {action.action.replace(/_/g, ' ')}
        {action.requiresApproval ? ' (needs approval)' : ''}
      </Button>
    </form>
  );
}

export function RecordDetail({
  entry,
  recordId,
  view,
  revealed,
}: {
  entry: RegisteredResource;
  recordId: string;
  view: Extract<DetailView, { status: 'ok' }>;
  revealed: string[];
}) {
  const { row } = view;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>
            {entry.def.label} {String(row.data[entry.titleField ?? 'id'] ?? row.id)}
          </CardTitle>
          {row.state ? <Badge tone="neutral">{row.state}</Badge> : null}
        </CardHeader>
        <CardBody className="grid grid-cols-2 gap-3 text-sm">
          {Object.entries(row.data).map(([field, value]) => (
            <div key={field}>
              <div className="text-xs uppercase tracking-wide text-neutral-500">{field}</div>
              <div className="flex items-center gap-2">
                <span className={row.masked.includes(field) ? 'font-mono text-neutral-500' : ''}>
                  {value instanceof Date ? formatDate(value) : String(value)}
                </span>
                {row.masked.includes(field) && view.revealable.includes(field) ? (
                  <Link
                    href={`/r/${entry.path}/${recordId}?reveal=${[...revealed, field].join(',')}`}
                    className="text-xs underline"
                  >
                    reveal
                  </Link>
                ) : null}
                {view.revealed.includes(field) ? <Badge tone="amber">revealed · audited</Badge> : null}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-2">
          {row.actions.map((action) => (
            <ActionButton key={action.action} entry={entry} recordId={recordId} action={action} />
          ))}
        </CardBody>
      </Card>

      {view.pendingApprovals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Awaiting approval</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            {view.pendingApprovals.map((request) => (
              <form key={request.id} action={decideApproval} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="resource" value={entry.def.name} />
                <input type="hidden" name="recordId" value={recordId} />
                <input type="hidden" name="approvalRequestId" value={request.id} />
                <span>
                  {request.action} requested by {request.requesterId} · {request.requiredApprovers}{' '}
                  approver(s)
                </span>
                <input
                  name="note"
                  placeholder="note"
                  className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                />
                <Button type="submit" name="decision" value="approved">
                  Approve
                </Button>
                <Button type="submit" name="decision" value="rejected" variant="danger">
                  Reject
                </Button>
              </form>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <AuditTimeline entries={view.history} />

      <form action={drainEffects}>
        <input type="hidden" name="returnTo" value={`/r/${entry.path}/${recordId}`} />
        <Button type="submit" variant="outline">
          Run effect worker
        </Button>
      </form>
    </div>
  );
}

export function AuditTimeline({ entries }: { entries: HistoryEntry[] }) {
  const tone = { write: 'green', read: 'amber', decision: 'blue', auth_denied: 'red' } as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Kind</Th>
            <Th>Action</Th>
            <Th>Actor</Th>
            <Th>Detail</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((event) => (
            <tr key={event.seq}>
              <Td className="whitespace-nowrap font-mono text-xs">{formatDate(event.at)}</Td>
              <Td>
                <Badge tone={tone[event.kind as keyof typeof tone] ?? 'neutral'}>{event.kind}</Badge>
              </Td>
              <Td>{event.action}</Td>
              <Td>
                {event.actorId}
                <span className="ml-1 text-xs text-neutral-500">{event.actorRoles.join(', ')}</span>
              </Td>
              <Td className="text-xs text-neutral-600">
                {event.fields.length > 0 ? `fields: ${event.fields.join(', ')}` : null}
                {event.reason ?? null}
              </Td>
            </tr>
          ))}
          {entries.length === 0 ? (
            <tr>
              <Td colSpan={5} className="text-sm text-neutral-500">
                No recorded activity.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </Card>
  );
}
