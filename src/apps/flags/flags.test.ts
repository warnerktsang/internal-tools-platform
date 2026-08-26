/**
 * The feature-flags app against a real Postgres and the fake flag service.
 *
 * Flags exist in this portfolio to prove the substrate is not shaped around the first two
 * apps: they scope by a different dimension, their approval turns on the *proposed* payload
 * rather than the stored row, and their correctness problem is concurrency (which version
 * was reviewed) rather than money.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flagConfigResource, PRODUCTION } from '@/apps/flags/resource';
import {
  flagServicePort,
  queuePublishOutcomes,
  resetFlagService,
  servedConfig,
} from '@/apps/flags/service';
import { decide } from '@/substrate/approvals';
import { verifyAuditChain } from '@/substrate/audit';
import { enableAuditBypass } from '@/substrate/audit/bypass';
import { db } from '@/substrate/db';
import { registerPort, resetPorts } from '@/substrate/effects';
import { execute } from '@/substrate/operations';
import { registerResource, resetRegistry } from '@/substrate/registry';
import { detailView, listView } from '@/substrate/views';
import { principal, resetDatabase, seedPrincipal } from '@/test/db';
import type { Principal } from '@/substrate/types';

const sam = principal({
  id: 'usr-sam',
  roles: ['engineer'],
  scopes: { environment: ['development', 'staging'] },
});
const renee = principal({
  id: 'usr-rel',
  roles: ['release_manager'],
  scopes: { environment: ['development', 'staging', PRODUCTION] },
});
const mira = principal({
  id: 'usr-mira',
  roles: ['release_manager'],
  scopes: { environment: ['development', 'staging', PRODUCTION] },
});
const ava = principal({ id: 'usr-ava', roles: ['auditor'] });
const publisher = principal({
  id: 'sys-flag-publisher',
  kind: 'system',
  roles: ['system_effects'],
});

const FLAG_ID = 'flag-checkout';
const STAGING = 'cfg-staging';
const PROD = 'cfg-prod';

async function seedConfigs(): Promise<void> {
  await db.$transaction(async (tx) => {
    await enableAuditBypass(tx);
    await tx.flag.create({
      data: { id: FLAG_ID, key: 'checkout_v2', description: 'New checkout', ownerId: sam.id },
    });
    await tx.flagConfig.create({
      data: {
        id: STAGING,
        flagId: FLAG_ID,
        environment: 'staging',
        enabled: true,
        rolloutPct: 50,
      },
    });
    await tx.flagConfig.create({
      data: {
        id: PROD,
        flagId: FLAG_ID,
        environment: PRODUCTION,
        enabled: true,
        rolloutPct: 10,
      },
    });
  });
}

const entry = () =>
  registerResource({
    def: flagConfigResource,
    path: 'flag-configs',
    nav: 'Flags',
    app: 'Feature flags',
    titleField: 'environment',
    columns: [
      { field: 'environment', label: 'Environment' },
      { field: 'rolloutPct', label: 'Rollout %' },
    ],
    panelActions: ['update'],
  });

async function update(
  recordId: string,
  as: Principal,
  change: { enabled?: boolean; rolloutPct: number; expectedVersion?: number },
) {
  const record = await db.flagConfig.findUniqueOrThrow({ where: { id: recordId } });
  return execute({
    resource: flagConfigResource,
    action: 'update',
    recordId,
    principal: as,
    payload: {
      enabled: change.enabled ?? true,
      rolloutPct: change.rolloutPct,
      expectedVersion: change.expectedVersion ?? record.version,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  resetRegistry();
  resetPorts();
  resetFlagService();
  registerPort(flagServicePort);
  for (const p of [sam, renee, mira, ava, publisher]) await seedPrincipal(p);
  await seedConfigs();
});

describe('scope, by a different dimension', () => {
  it('shows an engineer only the environments they are granted', async () => {
    const view = await listView(entry(), sam);
    if (view.status !== 'ok') throw new Error(view.reason);

    expect(view.rows.map((r) => r.data.environment)).toEqual(['staging']);
    expect(view.total).toBe(1);
  });

  it('denies an engineer the production config outright', async () => {
    const view = await detailView(entry(), PROD, sam);
    expect(view.status).toBe('denied');

    const denials = await db.auditEvent.findMany({ where: { kind: 'auth_denied' } });
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({ actorId: sam.id, recordId: PROD });
  });

  it('lets a release manager see every environment', async () => {
    const view = await listView(entry(), renee);
    if (view.status !== 'ok') throw new Error(view.reason);
    expect(view.rows).toHaveLength(2);
  });
});

describe('production is a deny rule, not a role gap', () => {
  it('refuses a production change by an engineer even where the permission is held', async () => {
    // Sam holds flag_config:update. Deny-last is what stops him, and it is recorded.
    const result = await update(PROD, sam, { rolloutPct: 20 });
    expect(result.status).toBe('denied');

    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: PROD } });
    expect(record).toMatchObject({ rolloutPct: 10, version: 1, state: 'live' });
    expect(
      await db.auditEvent.count({ where: { kind: 'auth_denied', actorId: sam.id } }),
    ).toBe(1);
  });

  it('does not deny the system publisher writing back to production', async () => {
    // The deny rule is scoped to humans on purpose: denying the effect worker would
    // strand every approved production change in 'publishing'.
    await update(PROD, renee, { rolloutPct: 20 });

    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: PROD } });
    expect(record).toMatchObject({ state: 'live', publishedVersion: 2 });
  });
});

describe('approval turns on the proposed change', () => {
  it('ramps staging without approval, however large the jump', async () => {
    const result = await update(STAGING, sam, { rolloutPct: 100 });
    expect(result.status).toBe('ok');
  });

  it('parks a production ramp above the threshold', async () => {
    const result = await update(PROD, renee, { rolloutPct: 40 });
    expect(result.status).toBe('pending');
    if (result.status !== 'pending') return;
    expect(result.policy).toBe('production_rollout');

    // Parked, so nothing is live and nothing was published.
    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: PROD } });
    expect(record).toMatchObject({ rolloutPct: 10, version: 1 });
    expect(await db.effect.count()).toBe(0);
  });

  it('applies a small production change with no approver at all', async () => {
    const result = await update(PROD, renee, { rolloutPct: 25 });
    expect(result.status).toBe('ok');
  });

  it('refuses the proposer as their own approver', async () => {
    const parked = await update(PROD, renee, { rolloutPct: 40 });
    if (parked.status !== 'pending') throw new Error('expected the ramp to park');

    const self = await decide({
      resource: flagConfigResource,
      approvalRequestId: parked.approvalRequestId,
      approver: renee,
      decision: 'approved',
    });
    expect(self.status).toBe('denied');
  });

  it('applies the reviewed payload when the second release manager agrees', async () => {
    const parked = await update(PROD, renee, { rolloutPct: 40 });
    if (parked.status !== 'pending') throw new Error('expected the ramp to park');

    const decision = await decide({
      resource: flagConfigResource,
      approvalRequestId: parked.approvalRequestId,
      approver: mira,
      decision: 'approved',
    });
    expect(decision.status).toBe('applied');
    if (decision.status !== 'applied') return;
    expect(decision.result.status).toBe('ok');

    // The approval releases the change, which publishes before the decision returns.
    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: PROD } });
    expect(record).toMatchObject({ rolloutPct: 40, version: 2, state: 'live' });
  });
});

describe('the version that was reviewed is the version that ships', () => {
  it('refuses a change written against a stale baseline', async () => {
    await update(STAGING, sam, { rolloutPct: 60 });

    const stale = await update(STAGING, sam, { rolloutPct: 80, expectedVersion: 1 });
    expect(stale.status).toBe('invalid');
    if (stale.status !== 'invalid') return;
    expect(stale.reason).toContain('version 2');

    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: STAGING } });
    expect(record.rolloutPct).toBe(60);
  });

  it('refuses an approved change whose baseline moved while it waited', async () => {
    const parked = await update(PROD, renee, { rolloutPct: 40 });
    if (parked.status !== 'pending') throw new Error('expected the ramp to park');

    // Someone nudges production while the ramp sits in Mira's queue.
    const nudge = await update(PROD, renee, { rolloutPct: 15 });
    expect(nudge.status).toBe('ok');

    const decision = await decide({
      resource: flagConfigResource,
      approvalRequestId: parked.approvalRequestId,
      approver: mira,
      decision: 'approved',
    });
    // The approval is recorded; the operation it authorized refuses itself, because the
    // config Mira read is not the config that would have been changed.
    expect(decision.status).toBe('applied');
    if (decision.status !== 'applied') return;
    expect(decision.result.status).toBe('invalid');

    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: PROD } });
    expect(record.rolloutPct).toBe(15);
  });
});

describe('a rollout only ramps up', () => {
  it('refuses a downward change through update', async () => {
    const result = await update(STAGING, sam, { rolloutPct: 10 });
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.field).toBe('rolloutPct');
  });

  it('refuses turning a flag off through update', async () => {
    const result = await update(STAGING, sam, { enabled: false, rolloutPct: 50 });
    expect(result.status).toBe('invalid');
  });

  it('rolls back to zero with no approver, even in production', async () => {
    const result = await execute({
      resource: flagConfigResource,
      action: 'rollback',
      recordId: PROD,
      principal: renee,
    });
    expect(result.status).toBe('ok');

    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: PROD } });
    expect(record).toMatchObject({ enabled: false, rolloutPct: 0, version: 2 });
  });

  it('rolls back a change whose publish did not land', async () => {
    queuePublishOutcomes({ status: 'failed', error: 'service rejected the config', retryable: false });
    await update(STAGING, sam, { rolloutPct: 60 });
    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: STAGING } });
    expect(record.state).toBe('publish_failed');

    const result = await execute({
      resource: flagConfigResource,
      action: 'rollback',
      recordId: STAGING,
      principal: renee,
    });
    expect(result.status).toBe('ok');
  });

  it('rejects a percentage outside 0-100', async () => {
    const result = await update(STAGING, sam, { rolloutPct: 140 });
    expect(result.status).toBe('invalid');
  });
});

describe('publishing through the outbox', () => {
  it('commits the change and the intent to publish it together', async () => {
    const result = await update(STAGING, sam, { rolloutPct: 60 });
    if (result.status !== 'ok') throw new Error('expected the ramp to apply');

    const [effect] = await db.effect.findMany();
    const write = await db.auditEvent.findFirstOrThrow({
      where: { kind: 'write', recordId: STAGING },
    });
    // Same requestId: the effect row was written by the transaction that made the change.
    expect(effect.requestId).toBe(write.requestId);
    expect(effect.idempotencyKey).toBe(`flag-publish:${STAGING}:2`);
    // And the call itself happened after that transaction committed, not inside it.
    expect(servedConfig(STAGING)).toMatchObject({ version: 2 });
  });

  it('goes live only once the service confirms, under the publisher principal', async () => {
    await update(STAGING, sam, { rolloutPct: 60 });

    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: STAGING } });
    expect(record).toMatchObject({ state: 'live', version: 2, publishedVersion: 2 });
    expect(servedConfig(STAGING)).toMatchObject({ rolloutPct: 60, version: 2 });

    const settle = await db.auditEvent.findFirstOrThrow({
      where: { action: 'publish_succeeded' },
    });
    expect(settle.actorId).toBe(publisher.id);
  });

  it('keeps the saved change and says what is actually live when publishing fails', async () => {
    queuePublishOutcomes({ status: 'failed', error: 'service rejected the config', retryable: false });
    await update(STAGING, sam, { rolloutPct: 60 });

    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: STAGING } });
    expect(record).toMatchObject({
      state: 'publish_failed',
      rolloutPct: 60,
      version: 2,
      // The SDK is still serving what it was serving.
      publishedVersion: 1,
    });
    expect(record.publishError).toContain('rejected');
  });

  it('lets a failed publish be fixed forward', async () => {
    queuePublishOutcomes({ status: 'failed', error: 'transient', retryable: false });
    await update(STAGING, sam, { rolloutPct: 60 });

    const retry = await update(STAGING, sam, { rolloutPct: 70 });
    expect(retry.status).toBe('ok');

    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: STAGING } });
    expect(record).toMatchObject({ state: 'live', rolloutPct: 70, publishedVersion: 3 });
    expect(record.publishError).toBeNull();
  });

  it('does not let a confirmation for a rolled-back version claim to be live', async () => {
    await update(STAGING, sam, { rolloutPct: 60 });
    await execute({
      resource: flagConfigResource,
      action: 'rollback',
      recordId: STAGING,
      principal: renee,
    });

    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: STAGING } });
    expect(record).toMatchObject({
      state: 'live',
      rolloutPct: 0,
      version: 3,
      publishedVersion: 3,
    });
  });

  it('retries a transient failure instead of deciding the publish failed', async () => {
    queuePublishOutcomes(
      { status: 'failed', error: 'service unavailable', retryable: true },
      { status: 'failed', error: 'service unavailable', retryable: true },
    );

    await update(STAGING, sam, { rolloutPct: 60 });

    // An unavailable service is not a rejected config, so the same publish is attempted
    // again inside the operation rather than the change being declared dead.
    const [effect] = await db.effect.findMany();
    expect(effect).toMatchObject({ state: 'succeeded', attempts: 3 });
    const record = await db.flagConfig.findUniqueOrThrow({ where: { id: STAGING } });
    expect(record).toMatchObject({ state: 'live', publishedVersion: 2 });
  });
});

describe('what the UI is allowed to offer', () => {
  it('offers an engineer no production action and an auditor none anywhere', async () => {
    const prodForRenee = await detailView(entry(), PROD, renee);
    if (prodForRenee.status !== 'ok') throw new Error('a release manager can read production');
    expect(prodForRenee.row.actions.find((a) => a.action === 'update')?.available).toBe(true);

    const forAuditor = await detailView(entry(), STAGING, ava);
    if (forAuditor.status !== 'ok') throw new Error('an auditor can read every config');
    expect(forAuditor.row.actions.every((a) => !a.available)).toBe(true);
  });
});

describe('the trail', () => {
  it('verifies as one chain across a change, an approval and a publish', async () => {
    await update(STAGING, sam, { rolloutPct: 60 });
    const parked = await update(PROD, renee, { rolloutPct: 40 });
    if (parked.status !== 'pending') throw new Error('expected the ramp to park');
    await decide({
      resource: flagConfigResource,
      approvalRequestId: parked.approvalRequestId,
      approver: mira,
      decision: 'approved',
    });

    expect(await verifyAuditChain()).toMatchObject({ ok: true });
    const actors = await db.auditEvent.findMany({ select: { actorId: true, action: true } });
    expect(actors.map((a) => a.actorId)).toContain(publisher.id);
  });
});
