/**
 * The KYC app against a real Postgres.
 *
 * The substrate's mechanics (masking, scope filtering, approval parking) are tested in the
 * substrate. These tests are about whether the KYC *declaration* adds up to a review tool
 * that cannot leak PII silently, cannot be decided by a bystander, and cannot approve a
 * customer with no evidence on file.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { kycCaseResource } from '@/apps/kyc/resource';
import { decide } from '@/substrate/approvals';
import { verifyAuditChain } from '@/substrate/audit';
import { enableAuditBypass } from '@/substrate/audit/bypass';
import { db } from '@/substrate/db';
import { execute } from '@/substrate/operations';
import { registerResource, resetRegistry } from '@/substrate/registry';
import { detailView, listView } from '@/substrate/views';
import { principal, resetDatabase, seedPrincipal } from '@/test/db';
import type { Principal } from '@/substrate/types';

const nadia = principal({
  id: 'usr-nadia',
  roles: ['kyc_analyst'],
  scopes: { business_unit: ['bu-consumer'] },
});
const raj = principal({
  id: 'usr-raj',
  roles: ['kyc_analyst'],
  scopes: { business_unit: ['bu-smb'] },
});
const omar = principal({ id: 'usr-omar', roles: ['compliance_officer'] });
const ava = principal({ id: 'usr-ava', roles: ['auditor'] });

const CASE_ID = 'kyc-1';
const OTHER_BU_CASE_ID = 'kyc-2';
const SSN = '412-88-6789';

async function seedCase(
  id: string,
  overrides: Partial<{ businessUnitId: string; riskScore: number; documentKinds: string[] }> = {},
): Promise<void> {
  const { businessUnitId = 'bu-consumer', riskScore = 20, documentKinds = ['identity'] } = overrides;
  await db.$transaction(async (tx) => {
    await enableAuditBypass(tx);
    await tx.kycCase.create({
      data: {
        id,
        reference: `KYC-${id}`,
        businessUnitId,
        customerName: 'Marcus Webb',
        ssn: SSN,
        dob: new Date('1987-04-12T00:00:00Z'),
        address: '218 Harlow Street, Apt 4B, Portland OR',
        nationality: 'US',
        riskScore,
        slaDueAt: new Date(Date.now() + 86_400_000),
      },
    });
    for (const kind of documentKinds) {
      await tx.kycDocument.create({
        data: { caseId: id, kind, filename: `${kind}.pdf`, storageKey: `s3://kyc/${id}/${kind}` },
      });
    }
  });
}

const entry = () =>
  registerResource({
    def: kycCaseResource,
    path: 'kyc-cases',
    nav: 'Review queue',
    app: 'KYC',
    titleField: 'reference',
    columns: [
      { field: 'reference', label: 'Case' },
      { field: 'ssn', label: 'SSN' },
    ],
    panelActions: ['approve', 'reject', 'escalate', 'request_info'],
  });

async function claim(id: string, as: Principal) {
  return execute({ resource: kycCaseResource, action: 'claim', recordId: id, principal: as });
}

async function decision(id: string, action: string, as: Principal, reason = 'a sufficient reason') {
  return execute({
    resource: kycCaseResource,
    action,
    recordId: id,
    principal: as,
    payload: { reason },
  });
}

beforeEach(async () => {
  await resetDatabase();
  resetRegistry();
  for (const p of [nadia, raj, omar, ava]) await seedPrincipal(p);
  await seedCase(CASE_ID);
  await seedCase(OTHER_BU_CASE_ID, { businessUnitId: 'bu-smb' });
});

describe('PII', () => {
  it('masks restricted fields in the queue and never serializes the raw value', async () => {
    const view = await listView(entry(), nadia);
    if (view.status !== 'ok') throw new Error(view.reason);

    const row = view.rows.find((r) => r.id === CASE_ID)!;
    expect(row.data.ssn).toBe('••••6789');
    expect(row.masked).toEqual(expect.arrayContaining(['ssn', 'dob', 'address']));
    expect(JSON.stringify(view.rows)).not.toContain(SSN);
  });

  it('reveals a restricted field only on request, and records who read it', async () => {
    const view = await detailView(entry(), CASE_ID, nadia, { reveal: ['ssn'] });
    if (view.status !== 'ok') throw new Error('expected the case to be readable');

    expect(view.row.data.ssn).toBe(SSN);
    expect(view.revealed).toEqual(['ssn']);

    const reads = await db.auditEvent.findMany({ where: { kind: 'read', recordId: CASE_ID } });
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ actorId: nadia.id, fields: ['ssn'] });
  });

  it('gives an auditor the case but not the PII', async () => {
    const view = await detailView(entry(), CASE_ID, ava, { reveal: ['ssn'] });
    if (view.status !== 'ok') throw new Error('an auditor can read every case');

    expect(view.row.data.ssn).toBe('••••6789');
    expect(view.revealable).toEqual([]);
    // No reveal happened, so nothing may claim one did.
    expect(await db.auditEvent.count({ where: { kind: 'read' } })).toBe(0);
  });
});

describe('scope', () => {
  it('shows an analyst only their own business unit, totals included', async () => {
    const view = await listView(entry(), nadia);
    if (view.status !== 'ok') throw new Error(view.reason);

    expect(view.rows.map((r) => r.id)).toEqual([CASE_ID]);
    expect(view.total).toBe(1);
  });

  it('denies a cross-business-unit read and keeps the attempt', async () => {
    const view = await detailView(entry(), OTHER_BU_CASE_ID, nadia);
    expect(view.status).toBe('denied');

    const denials = await db.auditEvent.findMany({ where: { kind: 'auth_denied' } });
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({ actorId: nadia.id, recordId: OTHER_BU_CASE_ID });
  });

  it('denies a cross-business-unit claim', async () => {
    const result = await claim(OTHER_BU_CASE_ID, nadia);
    expect(result.status).toBe('denied');
    const record = await db.kycCase.findUniqueOrThrow({ where: { id: OTHER_BU_CASE_ID } });
    expect(record).toMatchObject({ state: 'new', assigneeId: null });
  });
});

describe('the queue', () => {
  it('claims a case for the analyst who took it', async () => {
    expect((await claim(CASE_ID, nadia)).status).toBe('ok');
    const record = await db.kycCase.findUniqueOrThrow({ where: { id: CASE_ID } });
    expect(record).toMatchObject({ state: 'in_review', assigneeId: nadia.id });
  });

  it('refuses a second claim on a case someone else holds', async () => {
    await seedCase('kyc-3');
    await claim('kyc-3', nadia);
    // Same business unit, so this is a domain refusal, not an authorization one.
    const other = principal({
      id: 'usr-nadia-2',
      roles: ['kyc_analyst'],
      scopes: { business_unit: ['bu-consumer'] },
    });
    await seedPrincipal(other);

    const second = await claim('kyc-3', other);
    expect(second.status).toBe('invalid');
    if (second.status === 'invalid') expect(second.reason).toContain('in_review');
    expect((await db.kycCase.findUniqueOrThrow({ where: { id: 'kyc-3' } })).assigneeId).toBe(
      nadia.id,
    );
  });

  it('lets the holder release a case back to the queue', async () => {
    await claim(CASE_ID, nadia);
    expect((await execute({
      resource: kycCaseResource,
      action: 'release',
      recordId: CASE_ID,
      principal: nadia,
    })).status).toBe('ok');

    const record = await db.kycCase.findUniqueOrThrow({ where: { id: CASE_ID } });
    expect(record).toMatchObject({ state: 'new', assigneeId: null });
  });
});

describe('decisions', () => {
  it('refuses a decision from someone who does not hold the case', async () => {
    await claim(CASE_ID, nadia);
    const other = principal({
      id: 'usr-nadia-3',
      roles: ['kyc_analyst'],
      scopes: { business_unit: ['bu-consumer'] },
    });
    await seedPrincipal(other);

    const result = await decision(CASE_ID, 'approve', other);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.field).toBe('assigneeId');
  });

  it('refuses a decision with no usable reason', async () => {
    await claim(CASE_ID, nadia);
    const result = await decision(CASE_ID, 'approve', nadia, 'ok');
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.field).toBe('reason');
  });

  it('refuses to approve a case with no identity document on file', async () => {
    await seedCase('kyc-no-doc', { documentKinds: ['address'] });
    await claim('kyc-no-doc', nadia);

    const result = await decision('kyc-no-doc', 'approve', nadia);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.field).toBe('documents');
    const record = await db.kycCase.findUniqueOrThrow({ where: { id: 'kyc-no-doc' } });
    expect(record.state).toBe('in_review');
  });

  it('approves a low-risk evidenced case outright, keeping the reason', async () => {
    await claim(CASE_ID, nadia);
    const result = await decision(CASE_ID, 'approve', nadia, 'passport matches the applicant');
    expect(result.status).toBe('ok');

    const record = await db.kycCase.findUniqueOrThrow({ where: { id: CASE_ID } });
    expect(record).toMatchObject({
      state: 'approved',
      decisionReason: 'passport matches the applicant',
    });
  });

  it('sends a high-risk approval to compliance instead', async () => {
    await seedCase('kyc-high', { riskScore: 81 });
    await claim('kyc-high', nadia);

    const result = await decision('kyc-high', 'approve', nadia);
    expect(result.status).toBe('pending');
    if (result.status === 'pending') expect(result.policy).toBe('high_risk');

    const record = await db.kycCase.findUniqueOrThrow({ where: { id: 'kyc-high' } });
    expect(record.state).toBe('in_review');
  });

  it('releases a case back to the queue when information is requested', async () => {
    await claim(CASE_ID, nadia);
    const result = await decision(CASE_ID, 'request_info', nadia, 'proof of address is illegible');
    expect(result.status).toBe('ok');

    const record = await db.kycCase.findUniqueOrThrow({ where: { id: CASE_ID } });
    expect(record).toMatchObject({ state: 'info_requested', assigneeId: null });
  });
});

describe('rejection needs compliance', () => {
  it('parks the rejection, refuses the requester, and applies it on the officer’s approval', async () => {
    await claim(CASE_ID, nadia);
    const parked = await decision(CASE_ID, 'reject', nadia, 'documents do not match the applicant');
    if (parked.status !== 'pending') throw new Error(`expected pending, got ${parked.status}`);

    // Nothing has moved yet: a rejection is not a rejection until compliance agrees.
    expect((await db.kycCase.findUniqueOrThrow({ where: { id: CASE_ID } })).state).toBe('in_review');

    const bySelf = await decide({
      resource: kycCaseResource,
      approvalRequestId: parked.approvalRequestId,
      approver: nadia,
      decision: 'approved',
    });
    expect(bySelf.status).toBe('denied');

    // An analyst has no approve permission at all, regardless of who requested it.
    const byPeer = await decide({
      resource: kycCaseResource,
      approvalRequestId: parked.approvalRequestId,
      approver: raj,
      decision: 'approved',
    });
    expect(byPeer.status).toBe('denied');

    const byOfficer = await decide({
      resource: kycCaseResource,
      approvalRequestId: parked.approvalRequestId,
      approver: omar,
      decision: 'approved',
      note: 'agreed',
    });
    if (byOfficer.status !== 'applied') throw new Error(`expected applied, got ${byOfficer.status}`);
    expect(byOfficer.result.status).toBe('ok');

    const record = await db.kycCase.findUniqueOrThrow({ where: { id: CASE_ID } });
    expect(record).toMatchObject({
      state: 'rejected',
      // The reviewed payload is what gets applied, not a fresh one.
      decisionReason: 'documents do not match the applicant',
    });
  });

  it('leaves the case untouched when compliance refuses the rejection', async () => {
    await claim(CASE_ID, nadia);
    const parked = await decision(CASE_ID, 'reject', nadia);
    if (parked.status !== 'pending') throw new Error('expected the rejection to park');

    const refused = await decide({
      resource: kycCaseResource,
      approvalRequestId: parked.approvalRequestId,
      approver: omar,
      decision: 'rejected',
      note: 'insufficient grounds',
    });
    expect(refused.status).toBe('rejected');
    expect((await db.kycCase.findUniqueOrThrow({ where: { id: CASE_ID } })).state).toBe('in_review');
  });
});

describe('the trail', () => {
  it('records the whole review as one verifiable chain', async () => {
    await detailView(entry(), CASE_ID, nadia, { reveal: ['ssn'] });
    await claim(CASE_ID, nadia);
    await decision(CASE_ID, 'reject', nadia, 'documents do not match the applicant');
    await detailView(entry(), OTHER_BU_CASE_ID, nadia);

    expect(await verifyAuditChain()).toEqual({ ok: true, checked: expect.any(Number) });

    const kinds = await db.auditEvent.findMany({
      where: { resource: 'kyc_case' },
      orderBy: { seq: 'asc' },
      select: { kind: true, action: true },
    });
    expect(kinds).toEqual([
      { kind: 'read', action: 'reveal_pii' },
      { kind: 'write', action: 'claim' },
      { kind: 'decision', action: 'reject:requested' },
      { kind: 'auth_denied', action: 'read' },
    ]);
  });
});

describe('generated screens', () => {
  it('hides the panel-owned actions from the generated action card', async () => {
    await claim(CASE_ID, nadia);
    const view = await detailView(entry(), CASE_ID, nadia);
    if (view.status !== 'ok') throw new Error('expected the case to be readable');

    // The panel collects the reason for these; a payload-less button would only be refused.
    const generated = view.row.actions
      .filter((action) => !(entry().panelActions ?? []).includes(action.action))
      .map((action) => action.action);
    expect(generated).toEqual(['claim', 'release']);
  });

  it('offers no decision control to an analyst who does not hold the case', async () => {
    await claim(CASE_ID, nadia);
    const lea = principal({
      id: 'usr-lea',
      roles: ['kyc_analyst'],
      scopes: { business_unit: ['bu-consumer'] },
    });
    await seedPrincipal(lea);

    const view = await detailView(entry(), CASE_ID, lea);
    if (view.status !== 'ok') throw new Error('a same-unit analyst can read the case');

    // Every action she could click would only be refused, so none is offered — and the
    // reason shown is the one the guard would have produced.
    for (const action of view.row.actions) {
      expect(action.available).toBe(false);
      expect(action.reason).toBeTruthy();
    }
    expect(
      view.row.actions.find((action) => action.action === 'approve')?.reason,
    ).toContain(nadia.id);
  });
});
