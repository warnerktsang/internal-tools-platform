/**
 * The fake flag service, behind the same port interface a real one would use.
 *
 * Publishing is the only external call flags makes, and it is the reason this app reuses
 * the outbox built for refunds rather than writing anything new: the config change and the
 * intent to publish it commit together, the publish happens after commit with a stable
 * idempotency key, and its outcome comes back through `execute()` as a system principal.
 *
 * Deliberately fallible: a rollout of exactly 66% is rejected by the service, so
 * `publish_failed` — a change that is saved but not live — is reachable in the demo rather
 * than only in a test.
 */
import type { Port, PortOperation } from '@/substrate/effects';
import { execute } from '@/substrate/operations';
import type { PortOutcome } from '@/substrate/types';
import { flagConfigResource } from '@/apps/flags/resource';

export const FLAG_PUBLISHER_PRINCIPAL_ID = 'sys-flag-publisher';

const REJECTED_PCT = 66;

/** What the SDK would actually be serving, keyed by config id. */
const served = new Map<string, { enabled: boolean; rolloutPct: number; version: number }>();

const scripted: PortOutcome[] = [];

export function queuePublishOutcomes(...outcomes: PortOutcome[]): void {
  scripted.push(...outcomes);
}

export function resetFlagService(): void {
  scripted.length = 0;
  served.clear();
}

export function servedConfig(configId: string) {
  return served.get(configId) ?? null;
}

const publishOperation: PortOperation = {
  async execute(payload) {
    if (scripted.length > 0) return scripted.shift()!;

    const rolloutPct = Number(payload.rolloutPct);
    if (rolloutPct === REJECTED_PCT) {
      return { status: 'failed', error: 'flag service rejected the config', retryable: false };
    }

    served.set(String(payload.configId), {
      enabled: payload.enabled === true,
      rolloutPct,
      version: Number(payload.version),
    });
    return { status: 'succeeded', result: { version: Number(payload.version) } };
  },

  /**
   * Note what is *not* here: no branch for 'unknown'. A publish is idempotent and
   * re-readable, so an undetermined outcome is simply retried — unlike a refund, where
   * retrying a call that may have moved money is the whole problem. Same machinery, and
   * the app decides how much paranoia its domain deserves.
   */
  async settle({ outcome, effect, principal }) {
    if (outcome.status === 'unknown') return;

    await execute({
      resource: flagConfigResource,
      action: outcome.status === 'succeeded' ? 'publish_succeeded' : 'publish_failed',
      recordId: effect.recordId,
      principal,
      // The version travels with the outcome either way: a confirmation the config has
      // already moved past must be recognisable as stale.
      payload: {
        version: effect.payload.version,
        error: outcome.status === 'failed' ? outcome.error : null,
      },
      idempotencyKey: `flag-settle:${effect.idempotencyKey}:${outcome.status}`,
    });
  },
};

export const flagServicePort: Port = {
  name: 'flags',
  systemPrincipalId: FLAG_PUBLISHER_PRINCIPAL_ID,
  operations: { publish: publishOperation },
};
