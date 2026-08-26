/**
 * Transactional outbox, drained synchronously.
 *
 * An external call cannot be inside the transaction that commits the domain write, and
 * that single fact generates most of the hard behaviour in refunds: a timeout is not a
 * failure, a retry must not double-charge, and a webhook can arrive twice or early.
 *
 * So: the intent is enqueued in the same transaction as the write (it can never be lost,
 * and it can never happen without a record), executed *after commit* with an idempotency
 * key, and its outcome re-enters the system as a *new* operation under a system principal
 * — through the same `execute()` path a human uses. There is no side door into domain state.
 *
 * The queue is not deferred: `execute()` drains the effect it just enqueued before it
 * returns, so an action is synchronous from the caller's point of view and there is no
 * worker to run. Retries happen inline, without backoff, until the outcome is terminal.
 * A real deployment would move this loop to a cron or queue consumer to survive the
 * process dying mid-call; the row it claims, and everything below, would not change.
 */
import { Prisma } from '@prisma/client';
import { db } from '@/substrate/db';
import { systemPrincipal } from '@/substrate/identity';
import type { Db, EffectIntent, OperationResult, PortOutcome, Principal, Tx } from '@/substrate/types';

export type EffectRow = {
  id: string;
  port: string;
  operation: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  resource: string;
  recordId: string;
  requestId: string;
  attempts: number;
  maxAttempts: number;
};

export type PortOperation = {
  execute(payload: Record<string, unknown>, idempotencyKey: string): Promise<PortOutcome>;
  /**
   * How the outcome comes back into the domain. Implementations call `execute()` with a
   * transition, so the completion is authorized, guarded and audited like any other write.
   */
  settle?(args: {
    outcome: PortOutcome;
    effect: EffectRow;
    principal: Principal;
  }): Promise<void>;
};

export type Port = {
  name: string;
  /** Effects act as this seeded system principal; audit rows show it as the actor. */
  systemPrincipalId: string;
  operations: Record<string, PortOperation>;
};

const ports = new Map<string, Port>();

export function registerPort(port: Port): void {
  ports.set(port.name, port);
}

export function resetPorts(): void {
  ports.clear();
}

function portOperation(port: string, operation: string): { port: Port; op: PortOperation } {
  const found = ports.get(port);
  if (!found) throw new Error(`port '${port}' is not registered`);
  const op = found.operations[operation];
  if (!op) throw new Error(`port '${port}' has no operation '${operation}'`);
  return { port: found, op };
}

/** Enqueued in the caller's transaction. A duplicate idempotency key is a no-op, not an error. */
export async function enqueueEffect(
  tx: Tx,
  intent: EffectIntent,
  context: { resource: string; recordId: string; requestId: string },
): Promise<{ effectId: string; deduplicated: boolean }> {
  const existing = await tx.effect.findUnique({
    where: { idempotencyKey: intent.idempotencyKey },
    select: { id: true },
  });
  if (existing) return { effectId: existing.id, deduplicated: true };

  const row = await tx.effect.create({
    data: {
      port: intent.port,
      operation: intent.operation,
      payload: intent.payload as Prisma.InputJsonValue,
      idempotencyKey: intent.idempotencyKey,
      resource: context.resource,
      recordId: context.recordId,
      requestId: context.requestId,
    },
    select: { id: true },
  });
  return { effectId: row.id, deduplicated: false };
}

const BACKOFF_MS = [0, 1_000, 5_000, 30_000];

function toRow(row: {
  id: string;
  port: string;
  operation: string;
  payload: Prisma.JsonValue;
  idempotencyKey: string;
  resource: string;
  recordId: string;
  requestId: string;
  attempts: number;
  maxAttempts: number;
}): EffectRow {
  return {
    ...row,
    payload:
      row.payload !== null && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
  };
}

/**
 * Claims one queued effect and runs it. `SKIP LOCKED` so two concurrent requests cannot
 * both execute the same external call.
 */
async function claim(client: Db, effectId?: string): Promise<EffectRow | null> {
  const claimed = await client.$transaction(async (tx) => {
    const rows =
      effectId === undefined
        ? await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM effects
            WHERE state = 'queued' AND "nextAttemptAt" <= now()
            ORDER BY "nextAttemptAt" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          `
        : // A named effect is claimed regardless of its schedule: the caller is waiting on
          // this one outcome, so a backoff it will never come back to observe is worse than
          // retrying now.
          await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM effects
            WHERE id = ${effectId} AND state = 'queued'
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          `;
    if (rows.length === 0) return null;
    return tx.effect.update({
      where: { id: rows[0].id },
      data: { state: 'running', attempts: { increment: 1 } },
      select: {
        id: true,
        port: true,
        operation: true,
        payload: true,
        idempotencyKey: true,
        resource: true,
        recordId: true,
        requestId: true,
        attempts: true,
        maxAttempts: true,
      },
    });
  });
  return claimed === null ? null : toRow(claimed);
}

export type EffectResult = {
  effectId: string;
  outcome: PortOutcome['status'];
  /** 'unknown' propagates to the caller as an operation result: the outcome is undetermined. */
  operation: OperationResult<{ effectId: string }> | null;
  retrying: boolean;
};

async function requeue(effect: EffectRow, lastError: string | null, client: Db): Promise<void> {
  await client.effect.update({
    where: { id: effect.id },
    data: {
      state: 'queued',
      lastError,
      nextAttemptAt: new Date(
        Date.now() + (BACKOFF_MS[Math.min(effect.attempts, BACKOFF_MS.length - 1)] ?? 30_000),
      ),
    },
  });
}

async function runOne(effect: EffectRow, client: Db): Promise<EffectResult> {
  const { port, op } = portOperation(effect.port, effect.operation);

  let outcome: PortOutcome;
  try {
    outcome = await op.execute(effect.payload, effect.idempotencyKey);
  } catch (error) {
    // A thrown error is indistinguishable from a timeout: the call may have landed.
    outcome = { status: 'unknown', error: error instanceof Error ? error.message : String(error) };
  }

  const error = outcome.status === 'succeeded' ? null : outcome.error;

  if (outcome.status === 'failed' && effect.attempts < effect.maxAttempts) {
    await requeue(effect, error, client);
    return { effectId: effect.id, outcome: outcome.status, operation: null, retrying: true };
  }

  // Settle before marking the effect terminal. The reverse order loses the outcome
  // permanently if settlement fails: the queue would show the call as done while the
  // domain row never moved. Settlement re-enters through `execute()` with an idempotency
  // key, so re-running it after a requeue is a no-op rather than a second application.
  if (op.settle) {
    const principal = await systemPrincipal(port.systemPrincipalId);
    try {
      await op.settle({ outcome, effect, principal });
    } catch (settlementError) {
      await requeue(
        effect,
        settlementError instanceof Error ? settlementError.message : String(settlementError),
        client,
      );
      return { effectId: effect.id, outcome: outcome.status, operation: null, retrying: true };
    }
  }

  await client.effect.update({
    where: { id: effect.id },
    data: {
      state: outcome.status,
      lastError: error,
      completedAt: outcome.status === 'succeeded' ? new Date() : null,
    },
  });

  return {
    effectId: effect.id,
    outcome: outcome.status,
    operation:
      outcome.status === 'unknown'
        ? { status: 'unknown', effectId: effect.id, reason: outcome.error }
        : null,

    retrying: false,
  };
}

/**
 * Runs one named effect to a terminal outcome, retrying transient failures inline. Called
 * by `execute()` after the write commits, so the caller observes the settled record.
 */
export async function runEffect(
  effectId: string,
  options: { client?: Db } = {},
): Promise<EffectResult | null> {
  const { client = db } = options;
  let last: EffectResult | null = null;

  for (;;) {
    const effect = await claim(client, effectId);
    if (!effect) return last;
    try {
      last = await runOne(effect, client);
    } catch (error) {
      // The write is already committed, so a misconfigured port cannot be allowed to throw
      // out of the operation: the row stays queued and the caller is told it is undetermined.
      const reason = error instanceof Error ? error.message : String(error);
      await requeue(effect, reason, client);
      return {
        effectId: effect.id,
        outcome: 'unknown',
        operation: { status: 'unknown', effectId: effect.id, reason },
        retrying: false,
      };
    }
    if (!last.retrying) return last;
    if (effect.attempts >= effect.maxAttempts) {
      // Out of attempts and still not settled: the row stays queued for whatever sweeps it
      // later, and the caller is told the outcome is undetermined rather than fine. This is
      // the settlement-failed case — the provider may well have acted.
      return {
        ...last,
        operation: {
          status: 'unknown',
          effectId: effect.id,
          reason: `the outcome did not settle after ${effect.attempts} attempt(s)`,
        },
      };
    }
  }
}

/**
 * Drains whatever is queued. Nothing in the request path needs this — an effect is run by
 * the operation that enqueued it — but a row can outlive its request if the process dies
 * between commit and call, and this is what a cron or queue consumer would invoke.
 */
export async function runEffects(
  options: { limit?: number; client?: Db } = {},
): Promise<EffectResult[]> {
  const { limit = 20, client = db } = options;
  const results: EffectResult[] = [];

  for (let i = 0; i < limit; i += 1) {
    const effect = await claim(client);
    if (!effect) break;
    results.push(await runOne(effect, client));
  }

  return results;
}
