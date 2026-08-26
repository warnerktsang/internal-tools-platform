import { changeRollout } from '@/apps/flags/actions';
import { PRODUCTION, PRODUCTION_APPROVAL_PCT } from '@/apps/flags/resource';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { db } from '@/substrate/db';
import type { AvailableAction } from '@/substrate/views';

/**
 * Rendered on a flag config's detail screen. The form is prefilled from the row and carries
 * that row's version, which is what makes a stale approval detectable: whatever the
 * approver reads here is the baseline the change is checked against when it commits.
 */
export async function RolloutPanel({
  recordId,
  data,
  actions,
}: {
  recordId: string;
  data: Record<string, unknown>;
  actions: AvailableAction[];
}) {
  const update = actions.find((action) => action.action === 'update');
  const flag = await db.flag.findUnique({ where: { id: String(data.flagId) } });
  const version = Number(data.version);
  const published = Number(data.publishedVersion);
  const isProduction = data.environment === PRODUCTION;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{flag ? flag.key : 'Flag'} · {String(data.environment)}</CardTitle>
        <Badge tone={version === published ? 'neutral' : 'amber'}>
          {version === published
            ? `v${version} live`
            : `v${version} saved, v${published} live`}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        {flag ? <p className="text-sm text-neutral-600">{flag.description}</p> : null}
        {data.publishError ? (
          <p className="text-sm text-amber-700">
            Last publish failed: {String(data.publishError)}. The change is saved but the SDK is
            still serving v{published}.
          </p>
        ) : null}

        <form action={changeRollout} className="flex flex-wrap items-end gap-4">
          <input type="hidden" name="recordId" value={recordId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={data.enabled === true}
              className="h-4 w-4"
            />
            Enabled
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Rollout %
            <input
              name="rolloutPct"
              type="number"
              min={0}
              max={100}
              defaultValue={Number(data.rolloutPct)}
              className="w-24 rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900"
            />
          </label>
          <Button
            type="submit"
            disabled={!update?.available}
            title={update?.reason ?? undefined}
          >
            Save and publish
          </Button>
        </form>

        <p className="text-xs text-neutral-500">
          {isProduction
            ? `Production: only a release manager may change this, and above ${PRODUCTION_APPROVAL_PCT}% another release manager has to approve it. Rollback needs nobody.`
            : 'Non-production: engineers change this without approval. Ramping only goes up — use rollback to turn a flag off.'}
        </p>
      </CardBody>
    </Card>
  );
}
