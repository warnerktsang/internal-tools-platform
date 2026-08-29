import { Eye, Lock, Search } from 'lucide-react';
import Link from 'next/link';
import { decideApproval, runAction } from '@/app/actions';
import { PageHeader, Tabs, type Tab } from '@/components/shell/page-header';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  IdChip,
  Input,
  StatusDot,
  Table,
  Td,
  Th,
  type BadgeTone,
} from '@/components/ui/primitives';
import { RowMenu } from '@/components/ui/row-menu';
import { cn, formatDate, formatMoneyMinor, humanize } from '@/lib/utils';
import type { Column, RegisteredResource } from '@/substrate/registry';
import type { AvailableAction, DetailView, HistoryEntry, ListView, ViewRow } from '@/substrate/views';

/**
 * State names come from each app's machine, so the shell cannot enumerate them. It reads the
 * one thing every workflow shares — settled, in flight, refused — and colours the dot.
 */
export function stateTone(state: string): BadgeTone {
  if (/(approved|settled|published|live|complete|closed)/.test(state)) return 'green';
  if (/(pending|awaiting|requested|review|publishing|draft|open)/.test(state)) return 'amber';
  if (/(rejected|failed|denied|cancel)/.test(state)) return 'red';
  if (/unknown/.test(state)) return 'blue';
  return 'neutral';
}

function cell(row: ViewRow, column: Column) {
  const value = row.data[column.field];
  if (value === null || value === undefined) return '—';
  switch (column.format) {
    case 'money_minor':
      return formatMoneyMinor(value);
    case 'date':
      return formatDate(value);
    case 'state':
      return <StatusDot tone={stateTone(String(value))}>{String(value)}</StatusDot>;
    default:
      return String(value);
  }
}

function scopeNote(view: Extract<ListView, { status: 'ok' }>): string | null {
  if (!view.scope) return null;
  return view.scope.mode === 'scoped'
    ? `scoped to ${view.scope.dimension} ${view.scope.values?.join(', ')}`
    : `${view.scope.mode} ${view.scope.dimension} access`;
}

function matches(row: ViewRow, entry: RegisteredResource, query: string): boolean {
  const haystack = entry.columns
    .map((column) => row.data[column.field])
    .concat(row.id, row.state)
    .map((value) => (value instanceof Date ? value.toISOString() : String(value ?? '')))
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function RecordList({
  entry,
  view,
  query = '',
}: {
  entry: RegisteredResource;
  view: ListView;
  query?: string;
}) {
  if (view.status === 'denied') {
    return (
      <>
        <PageHeader title={entry.nav} tile={false} subtitle={entry.app} />
        <Denied reason={view.reason} />
      </>
    );
  }

  // Filtering happens over rows the policy engine already returned, never as a way to reach
  // rows outside scope: the query is applied after `listView`, not folded into its predicate.
  const rows = query ? view.rows.filter((row) => matches(row, entry, query)) : view.rows;
  const note = scopeNote(view);

  return (
    <>
      <PageHeader
        title={entry.nav}
        tile={false}
        subtitle={`${entry.app} · ${entry.def.label.toLowerCase()} records`}
        meta={
          <>
            <Badge tone="neutral">
              {rows.length} of {view.total} visible
            </Badge>
            {note ? <span className="text-xs text-neutral-500">{note}</span> : null}
          </>
        }
      />

      <form className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={query}
            placeholder={`Search ${entry.nav.toLowerCase()}`}
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <Card>
        <Table>
          <thead>
            <tr>
              {entry.columns.map((column) => (
                <Th key={column.field}>{column.label}</Th>
              ))}
              <Th className="w-10">{null}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-neutral-50">
                {entry.columns.map((column, index) => (
                  <Td key={column.field}>
                    {index === 0 ? (
                      <Link
                        href={`/r/${entry.path}/${row.id}`}
                        className="font-medium text-accent-700 hover:underline"
                      >
                        {cell(row, column)}
                      </Link>
                    ) : (
                      cell(row, column)
                    )}
                  </Td>
                ))}
                <Td className="text-right">
                  <RowMenu
                    copyValue={row.id}
                    items={[
                      { label: 'Open record', href: `/r/${entry.path}/${row.id}` },
                      { label: 'View audit log', href: `/r/${entry.path}/${row.id}?tab=audit` },
                    ]}
                  />
                </Td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <Td colSpan={entry.columns.length + 1} className="text-sm text-neutral-500">
                  {query ? `Nothing matches “${query}”.` : 'Nothing in scope.'}
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </Card>
    </>
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

/**
 * A refusal is a result, not an error page: it names the rule that produced it, because the
 * point of the prototype is that authorization is legible.
 */
export function Denied({ reason }: { reason: string }) {
  return (
    <Card>
      <CardBody className="flex items-start gap-3 py-6">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
          <Lock className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <div className="text-sm font-semibold text-neutral-900">Access denied</div>
          <p className="mt-1 text-sm text-neutral-600">{reason}</p>
          <p className="mt-2 text-xs text-neutral-500">
            The decision was made on the server; nothing outside this principal&apos;s scope was
            fetched. Switch principals in the sidebar to see the same screen under different
            roles.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function FieldRow({
  field,
  value,
  masked,
  revealHref,
  revealed,
}: {
  field: string;
  value: unknown;
  masked: boolean;
  revealHref: string | null;
  revealed: boolean;
}) {
  const empty = value === null || value === undefined;
  return (
    <div className="flex items-baseline gap-4 px-4 py-2.5">
      <div className="w-44 shrink-0 text-sm text-neutral-500">{humanize(field)}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <span className={cn(masked && 'font-mono text-neutral-500', empty ? 'text-neutral-400' : 'text-neutral-900')}>
          {empty ? '—' : value instanceof Date ? formatDate(value) : String(value)}
        </span>
        {revealHref ? (
          <Link
            href={revealHref}
            className="inline-flex items-center gap-1 text-xs text-accent-700 hover:underline"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden />
            reveal
          </Link>
        ) : null}
        {revealed ? <Badge tone="amber">revealed · audited</Badge> : null}
      </div>
    </div>
  );
}

export function RecordDetail({
  entry,
  recordId,
  view,
  revealed,
  tab,
}: {
  entry: RegisteredResource;
  recordId: string;
  view: Extract<DetailView, { status: 'ok' }>;
  revealed: string[];
  tab: string;
}) {
  const { row } = view;
  const generated = row.actions.filter(
    (action) => !(entry.panelActions ?? []).includes(action.action),
  );
  const basePath = `/r/${entry.path}/${recordId}`;
  const tabs: Tab[] = [
    { key: 'details', label: 'Details' },
    { key: 'approvals', label: 'Approvals', count: view.pendingApprovals.length },
    { key: 'audit', label: 'Audit log', count: view.history.length },
  ];
  const current = tabs.some((candidate) => candidate.key === tab) ? tab : 'details';

  return (
    <>
      <PageHeader
        title={String(row.data[entry.titleField ?? 'id'] ?? row.id)}
        subtitle={`${entry.app} · ${entry.def.label}`}
        meta={
          <>
            {row.state ? <StatusDot tone={stateTone(row.state)}>{row.state}</StatusDot> : null}
            <IdChip>{row.id}</IdChip>
          </>
        }
        actions={generated.map((action) => (
          <ActionButton key={action.action} entry={entry} recordId={recordId} action={action} />
        ))}
      />

      <Tabs tabs={tabs} current={current} basePath={basePath} />

      {current === 'details' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Record</CardTitle>
            </CardHeader>
            <div className="divide-y divide-neutral-100">
              {Object.entries(row.data).map(([field, value]) => (
                <FieldRow
                  key={field}
                  field={field}
                  value={value}
                  masked={row.masked.includes(field)}
                  revealed={view.revealed.includes(field)}
                  revealHref={
                    row.masked.includes(field) && view.revealable.includes(field)
                      ? `${basePath}?reveal=${[...revealed, field].join(',')}`
                      : null
                  }
                />
              ))}
            </div>
          </Card>

          {entry.detailPanel ? (
            <entry.detailPanel recordId={recordId} data={row.data} actions={row.actions} />
          ) : null}
        </>
      ) : null}

      {current === 'approvals' ? <ApprovalsTab entry={entry} recordId={recordId} view={view} /> : null}

      {current === 'audit' ? <AuditTimeline entries={view.history} /> : null}
    </>
  );
}

function ApprovalsTab({
  entry,
  recordId,
  view,
}: {
  entry: RegisteredResource;
  recordId: string;
  view: Extract<DetailView, { status: 'ok' }>;
}) {
  if (view.pendingApprovals.length === 0) {
    return (
      <Card>
        <CardBody className="text-sm text-neutral-500">
          Nothing is waiting on a second person. Actions that need one park here instead of
          applying.
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Awaiting a second person</CardTitle>
      </CardHeader>
      <div className="divide-y divide-neutral-100">
        {view.pendingApprovals.map((request) => (
          <form
            key={request.id}
            action={decideApproval}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <input type="hidden" name="resource" value={entry.def.name} />
            <input type="hidden" name="recordId" value={recordId} />
            <input type="hidden" name="approvalRequestId" value={request.id} />
            <div className="min-w-0 flex-1 text-sm">
              <span className="font-medium text-neutral-900">
                {request.action.replace(/_/g, ' ')}
              </span>
              <span className="text-neutral-500">
                {' '}
                requested by {request.requesterId} · {request.requiredApprovers} approver(s)
              </span>
            </div>
            {request.decidable.available ? (
              <>
                <Input name="note" placeholder="note" className="w-56" />
                <Button type="submit" name="decision" value="approved">
                  Approve
                </Button>
                <Button type="submit" name="decision" value="rejected" variant="danger">
                  Reject
                </Button>
              </>
            ) : (
              <span className="text-xs text-neutral-500">
                you cannot decide this: {request.decidable.reason}
              </span>
            )}
          </form>
        ))}
      </div>
    </Card>
  );
}

export function AuditTimeline({ entries }: { entries: HistoryEntry[] }) {
  const tone = { write: 'green', read: 'amber', decision: 'blue', auth_denied: 'red' } as const;

  return (
    <Card>
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
            <tr key={event.seq} className="hover:bg-neutral-50">
              <Td className="whitespace-nowrap font-mono text-xs">{formatDate(event.at)}</Td>
              <Td>
                <StatusDot tone={tone[event.kind as keyof typeof tone] ?? 'neutral'}>
                  {event.kind}
                </StatusDot>
              </Td>
              <Td className="whitespace-nowrap">{event.action}</Td>
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
