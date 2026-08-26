/**
 * The fake payment processor — deliberately hostile.
 *
 * A fake that always returns success once deletes the exact problem that justifies owning
 * refunds in-house. This one times out, declines, and answers the same call twice, because
 * those are the cases the invariants have to survive. It is in-process and deterministic:
 * no network, no credentials, no flaky demo.
 *
 * Outcomes are keyed off the amount so any of them can be produced on purpose:
 *   ...13 -> timeout: the call is thrown away with the outcome undetermined, but the money
 *            moved on the processor's side, which is what reconciliation later discovers
 *   ...07 -> hard decline
 *   else  -> succeeded
 * `queueOutcomes()` overrides this in tests.
 *
 * Attempts are recorded in `processor_events`, not in memory, for two reasons: it is what
 * makes the processor's own idempotency real across processes (a retry cannot double-pay),
 * and it is what gives a later lookup something to find.
 */
import { Prisma } from '@prisma/client';
import { db } from '@/substrate/db';
import type { Port, PortOperation } from '@/substrate/effects';
import { systemPrincipal } from '@/substrate/identity';
import { execute } from '@/substrate/operations';
import type { PortOutcome } from '@/substrate/types';
import { refundResource } from '@/apps/refunds/resource';

export const REFUND_SETTLER_PRINCIPAL_ID = 'sys-refund-settler';

const TIMEOUT_ERROR = 'processor timeout after 30s: outcome undetermined';

const scripted: PortOutcome[] = [];

export function queueOutcomes(...outcomes: PortOutcome[]): void {
  scripted.push(...outcomes);
}

export function resetProcessor(): void {
  scripted.length = 0;
}

/** How many distinct calls the processor actually saw — retries must not increase this. */
export async function processorCallCount(): Promise<number> {
  return db.processorEvent.count({ where: { type: 'processor.attempt' } });
}

type Attempt = {
  /** What the caller was told. A timeout tells them nothing. */
  reported: 'succeeded' | 'failed' | 'timeout';
  /** What actually happened on the processor's side, which a lookup can reveal. */
  truth: 'succeeded' | 'failed';
  processorRef?: string;
  /** False for a decline; a transient error is not an attempt at all (see below). */
  retryable?: boolean;
};

function deterministicAttempt(payload: Record<string, unknown>): Attempt {
  const amount = Number(payload.amountMinor);
  const ref = `pi_${String(payload.reference ?? amount)}`;
  const last2 = Math.abs(amount % 100);
  if (last2 === 13) return { reported: 'timeout', truth: 'succeeded', processorRef: ref };
  if (last2 === 7) return { reported: 'failed', truth: 'failed', retryable: false };
  return { reported: 'succeeded', truth: 'succeeded', processorRef: ref };
}

function scriptedAttempt(outcome: PortOutcome): Attempt {
  if (outcome.status === 'succeeded') {
    return {
      reported: 'succeeded',
      truth: 'succeeded',
      processorRef: typeof outcome.result?.processorRef === 'string' ? outcome.result.processorRef : undefined,
    };
  }
  if (outcome.status === 'failed') {
    return { reported: 'failed', truth: 'failed', retryable: outcome.retryable ?? true };
  }
  return { reported: 'timeout', truth: 'succeeded' };
}

function report(attempt: Attempt): PortOutcome {
  if (attempt.reported === 'timeout') throw new Error(TIMEOUT_ERROR);
  if (attempt.reported === 'failed') {
    return {
      status: 'failed',
      // A declined card will be declined again; an unavailable processor will not.
      error: attempt.retryable === false ? 'card_declined' : 'processor_unavailable',
      retryable: attempt.retryable ?? true,
    };
  }
  return { status: 'succeeded', result: { processorRef: attempt.processorRef } };
}

async function loadAttempt(idempotencyKey: string): Promise<Attempt | null> {
  const row = await db.processorEvent.findUnique({
    where: { externalId: `attempt:${idempotencyKey}` },
    select: { payload: true },
  });
  if (!row || row.payload === null || typeof row.payload !== 'object' || Array.isArray(row.payload)) {
    return null;
  }
  return row.payload as unknown as Attempt;
}

const refundOperation: PortOperation = {
  async execute(payload, idempotencyKey) {
    const previous = await loadAttempt(idempotencyKey);
    // The processor's own idempotency: the second call is the first call's answer.
    if (previous) return report(previous);

    const attempt =
      scripted.length > 0 ? scriptedAttempt(scripted.shift()!) : deterministicAttempt(payload);

    // A transient error is not a decision: nothing was decided, so nothing is remembered
    // and the retry genuinely re-attempts. Only final answers — paid, declined, or the
    // ambiguous timeout — are recorded against the idempotency key.
    if (attempt.reported === 'failed' && attempt.retryable !== false) return report(attempt);

    await db.processorEvent.create({
      data: {
        externalId: `attempt:${idempotencyKey}`,
        type: 'processor.attempt',
        refundRef: typeof payload.refundId === 'string' ? payload.refundId : null,
        payload: attempt as unknown as Prisma.InputJsonValue,
        processedAt: new Date(),
        disposition: attempt.reported,
      },
    });

    return report(attempt);
  },

  /**
   * The outcome re-enters the domain as a new operation under a system principal. Note the
   * mapping: an undetermined call does not become 'failed'. Nobody knows yet, and the
   * refund says so until someone reconciles it.
   */
  async settle({ outcome, effect, principal }) {
    const action =
      outcome.status === 'succeeded' ? 'settle' : outcome.status === 'failed' ? 'fail' : 'mark_unknown';

    await execute({
      resource: refundResource,
      action,
      recordId: effect.recordId,
      principal,
      payload:
        outcome.status === 'succeeded' ? { processorRef: outcome.result?.processorRef ?? null } : {},
      idempotencyKey: `settle:${effect.idempotencyKey}:${action}`,
    });
  },
};

/** Reconciliation: ask what happened to a refund whose outcome we never learned. */
const lookupOperation: PortOperation = {
  async execute(payload) {
    const attempt = await loadAttempt(`refund:${String(payload.refundId)}`);
    if (!attempt) return { status: 'succeeded', result: { found: false } };
    return {
      status: 'succeeded',
      result: {
        found: true,
        settled: attempt.truth === 'succeeded',
        processorRef: attempt.processorRef ?? null,
      },
    };
  },

  async settle({ outcome, effect, principal }) {
    if (outcome.status !== 'succeeded') return;
    const data = (outcome.result ?? {}) as { found?: boolean; settled?: boolean; processorRef?: string };
    // No record of the call at all: the refund stays 'unknown' rather than being guessed at.
    if (!data.found) return;

    await execute({
      resource: refundResource,
      action: data.settled ? 'settle' : 'fail',
      recordId: effect.recordId,
      principal,
      payload: data.settled ? { processorRef: data.processorRef ?? null } : {},
      idempotencyKey: `reconcile:${effect.idempotencyKey}`,
    });
  },
};

export const processorPort: Port = {
  name: 'processor',
  systemPrincipalId: REFUND_SETTLER_PRINCIPAL_ID,
  operations: { refund: refundOperation, lookup: lookupOperation },
};

// ---------------------------------------------------------------------------
// Inbound webhooks
// ---------------------------------------------------------------------------

export type ProcessorWebhook = {
  /** The processor's event id. Delivery is at-least-once, so this is the dedupe key. */
  externalId: string;
  type: 'refund.succeeded' | 'refund.failed';
  refundId: string;
  processorRef?: string;
};

export type WebhookDisposition = 'applied' | 'duplicate' | 'out_of_order_converged' | 'unmatched';

/**
 * Webhook intake. Three hostile behaviours are handled here rather than assumed away:
 *   - redelivery: the same `externalId` is recorded once and applied once;
 *   - late or out-of-order delivery: an event describing an outcome the refund has already
 *     reached is recorded as converged, not applied twice and not treated as an error;
 *   - unmatched: an event for a refund we do not have is kept, not dropped.
 */
export async function receiveWebhook(event: ProcessorWebhook): Promise<WebhookDisposition> {
  const existing = await db.processorEvent.findUnique({ where: { externalId: event.externalId } });
  if (existing) return 'duplicate';

  const refund = await db.refund.findUnique({ where: { id: event.refundId } });

  let disposition: WebhookDisposition;
  if (!refund) {
    disposition = 'unmatched';
  } else {
    const principal = await systemPrincipal(REFUND_SETTLER_PRINCIPAL_ID);
    const result = await execute({
      resource: refundResource,
      action: event.type === 'refund.succeeded' ? 'settle' : 'fail',
      recordId: event.refundId,
      principal,
      payload: event.processorRef ? { processorRef: event.processorRef } : {},
      idempotencyKey: `webhook:${event.externalId}`,
    });

    // An invalid transition here means the refund is already terminal: the event is stale,
    // not wrong.
    disposition = result.status === 'ok' ? 'applied' : 'out_of_order_converged';
  }

  await db.processorEvent.create({
    data: {
      externalId: event.externalId,
      type: event.type,
      refundRef: event.refundId,
      payload: { ...event },
      processedAt: new Date(),
      disposition,
    },
  });

  return disposition;
}
