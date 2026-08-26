/**
 * The feature-flag admin panel: the third app, and the one that stresses different parts
 * of the substrate than the first two.
 *
 * What the app owns and the substrate deliberately does not:
 *   - flags scope by `environment`, not by business unit. Nothing in the substrate had to
 *     change for that: scope is a named dimension, so a dev-only engineer is filtered by
 *     the same predicate that filters KYC by business unit;
 *   - a change is reviewed against a specific version. An approval that sat in a queue
 *     while someone else edited the flag is stale, and applying it would ship a config
 *     nobody read — so `expectedVersion` is carried in the parked payload and re-checked
 *     when it replays;
 *   - a rollout only goes up. Coming down is `rollback`, which is a different operation
 *     with different governance;
 *   - rollback needs no approver. Requiring sign-off to stop an incident makes outages
 *     longer.
 *
 * Production restriction lives in a deny rule (`config/policy.ts`), not here: "engineers
 * may not touch production" is an authority statement, and deny-last is where those go.
 */
import { defineResource } from '@/substrate/resource';
import { invalid } from '@/substrate/types';
import type { GuardContext } from '@/substrate/types';

export type FlagConfigRow = {
  id: string;
  flagId: string;
  environment: string;
  enabled: boolean;
  rolloutPct: number;
  targeting: unknown;
  version: number;
  state: string;
  publishedVersion: number;
  publishError: string | null;
};

/** Above this, a production rollout is a release manager's decision, not one engineer's. */
export const PRODUCTION_APPROVAL_PCT = 25;

export const PRODUCTION = 'production';

type Change = { enabled: boolean; rolloutPct: number };

/**
 * The proposed change, validated. Read from the payload rather than the row because this
 * is also what an approval replays verbatim.
 */
function changeFrom({ payload }: GuardContext<FlagConfigRow>): Change {
  const rolloutPct = Number(payload.rolloutPct);
  if (!Number.isInteger(rolloutPct) || rolloutPct < 0 || rolloutPct > 100) {
    invalid('rollout must be a whole percentage between 0 and 100', 'rolloutPct');
  }
  return { enabled: payload.enabled === true, rolloutPct };
}

/**
 * Optimistic concurrency, and the reason the parked payload carries a baseline: two
 * engineers editing the same flag, or an approval granted an hour after the config moved,
 * would otherwise apply a change against a version nobody reviewed.
 */
function assertReviewedBaseline(ctx: GuardContext<FlagConfigRow>): void {
  const expected = Number(ctx.payload.expectedVersion);
  if (!Number.isInteger(expected)) invalid('the change is missing a baseline version', 'expectedVersion');
  if (expected !== ctx.record.version) {
    invalid(
      `this change was written against version ${expected}; the flag is now at version ${ctx.record.version}. Re-read it and decide again.`,
      'expectedVersion',
    );
  }
}

function assertMonotonicRollout(ctx: GuardContext<FlagConfigRow>): void {
  const { rolloutPct, enabled } = changeFrom(ctx);
  if (enabled && ctx.record.enabled && rolloutPct < ctx.record.rolloutPct) {
    invalid(
      `a rollout only ramps up: ${ctx.record.rolloutPct}% -> ${rolloutPct}% is a rollback, which needs the rollback action`,
      'rolloutPct',
    );
  }
  if (!enabled && ctx.record.enabled) {
    invalid('turning a flag off is a rollback, not a config change', 'enabled');
  }
}

/**
 * A publish confirmation for a version that has since been superseded — a rollback landed
 * while the ramp was in flight — must not be believed, or `publishedVersion` would name a
 * config the service is no longer serving.
 */
function assertConfirmationIsCurrent(ctx: GuardContext<FlagConfigRow>): void {
  if (Number(ctx.payload.version) !== ctx.record.version) {
    invalid(
      `this outcome is for version ${Number(ctx.payload.version)}; the config is at version ${ctx.record.version} and a newer publish is in flight`,
      'version',
    );
  }
}

/** Publishing the config to the (fake) flag service. Same key across retries. */
function publishEffect(record: FlagConfigRow, version: number, change: Change) {
  return {
    port: 'flags',
    operation: 'publish',
    payload: {
      configId: record.id,
      environment: record.environment,
      enabled: change.enabled,
      rolloutPct: change.rolloutPct,
      version,
    },
    idempotencyKey: `flag-publish:${record.id}:${version}`,
  };
}

export const flagConfigResource = defineResource<FlagConfigRow>({
  name: 'flag_config',
  table: 'flag_configs',
  label: 'Flag config',
  // The third scope dimension in the portfolio, and the reason scope is named rather than
  // hardcoded to business unit.
  scope: { dimension: 'environment', field: 'environment' },
  delegate: (tx) => tx.flagConfig,
  fields: {},
  machine: {
    initial: 'live',
    states: ['live', 'publishing', 'publish_failed'],
    transitions: [
      {
        action: 'update',
        // A failed publish is editable: fixing it forward is how flag incidents end.
        from: ['live', 'publish_failed'],
        to: 'publishing',
        permission: 'flag_config:update',
        requiresApproval: 'production_rollout',
        guard: (ctx) => {
          assertReviewedBaseline(ctx);
          assertMonotonicRollout(ctx);
        },
        apply: (ctx) => {
          const change = changeFrom(ctx);
          return { ...change, version: ctx.record.version + 1, publishError: null };
        },
        effect: (ctx) => publishEffect(ctx.record, ctx.record.version + 1, changeFrom(ctx)),
      },
      {
        /**
         * Zero approvers, deliberately: an incident is the worst time to need a second
         * signature. It is still authorized, still audited, and still monotonic in the
         * only direction that matters — off.
         */
        action: 'rollback',
        from: ['live', 'publishing', 'publish_failed'],
        to: 'publishing',
        permission: 'flag_config:rollback',
        apply: (ctx) => ({
          enabled: false,
          rolloutPct: 0,
          version: ctx.record.version + 1,
          publishError: null,
        }),
        effect: (ctx) =>
          publishEffect(ctx.record, ctx.record.version + 1, { enabled: false, rolloutPct: 0 }),
      },
      {
        action: 'publish_succeeded',
        from: ['publishing'],
        to: 'live',
        permission: 'flag_config:publish',
        guard: assertConfirmationIsCurrent,
        apply: ({ payload }) => ({
          publishedVersion: Number(payload.version),
          publishError: null,
        }),
      },
      {
        /**
         * The config row keeps the new version while `publishedVersion` still names what
         * the SDK is serving: the UI can say "version 4 is not live" instead of pretending
         * the change took effect.
         */
        action: 'publish_failed',
        from: ['publishing'],
        to: 'publish_failed',
        permission: 'flag_config:publish',
        guard: assertConfirmationIsCurrent,
        apply: ({ payload }) => ({ publishError: String(payload.error ?? 'publish failed') }),
      },
    ],
  },
  approvals: {
    production_rollout: {
      name: 'production_rollout',
      rules: [
        {
          // Environment *and* percentage: an earlier draft of this rule matched
          // `rolloutPct > 25` in any environment, which quietly required sign-off to ramp
          // a staging flag. Declarative policy makes that reviewable in a diff.
          appliesWhen: (subject) =>
            subject.environment === PRODUCTION &&
            Number(subject.rolloutPct) > PRODUCTION_APPROVAL_PCT,
          approvers: 1,
          eligibleRoles: ['release_manager'],
        },
      ],
      exclusions: { excludeRequester: true },
    },
  },
});
