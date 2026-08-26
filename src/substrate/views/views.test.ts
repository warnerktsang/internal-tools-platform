/**
 * The generated read path, exercised through a miniature case resource. What is under test
 * is that a screen nobody wrote still filters by scope, masks restricted fields, audits a
 * reveal and computes action availability on the server.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { enableAuditBypass } from '@/substrate/audit/bypass';
import type { PolicyCatalog } from '@/substrate/authz';
import { db } from '@/substrate/db';
import { registerResource, resetRegistry, type RegisteredResource } from '@/substrate/registry';
import { defineResource } from '@/substrate/resource';
import { principal, resetDatabase, seedPrincipal } from '@/test/db';
import { detailView, listView } from '@/substrate/views';

type CaseRow = {
  id: string;
  reference: string;
  businessUnitId: string;
  customerName: string;
  ssn: string;
  state: string;
  assigneeId: string | null;
};

const caseResource = defineResource<CaseRow>({
  name: 'kyc_case',
  table: 'kyc_cases',
  label: 'Case',
  delegate: (tx) => tx.kycCase,
  scope: { dimension: 'business_unit', field: 'businessUnitId' },
  fields: {
    ssn: { sensitivity: 'restricted', mask: 'last4', revealPermission: 'kyc_case:reveal_pii' },
  },
  machine: {
    initial: 'new',
    states: ['new', 'in_review', 'rejected'],
    transitions: [
      { action: 'claim', from: ['new'], to: 'in_review', permission: 'kyc_case:assign' },
      {
        action: 'reject',
        from: ['in_review'],
        to: 'rejected',
        permission: 'kyc_case:decide',
        requiresApproval: 'compliance',
      },
    ],
  },
  approvals: {
    compliance: {
      name: 'compliance',
      rules: [{ appliesWhen: () => true, approvers: 1, eligibleRoles: ['compliance_officer'] }],
      exclusions: { excludeRequester: true },
    },
  },
});

const catalog: PolicyCatalog = {
  roles: [
    {
      name: 'analyst',
      description: 'Reviews cases in their own business unit.',
      grant: 'own_scope',
      permissions: ['kyc_case:read', 'kyc_case:assign', 'kyc_case:reveal_pii'],
    },
    {
      name: 'auditor',
      description: 'Reads everything, changes nothing, sees no raw PII.',
      grant: 'global',
      permissions: ['kyc_case:read'],
    },
  ],
  denyRules: [],
};

let entry: RegisteredResource;

const analyst = principal({ id: 'ana', roles: ['analyst'], scopes: { business_unit: ['us'] } });
const auditor = principal({ id: 'aud', roles: ['auditor'] });
const stranger = principal({ id: 'str', roles: [], scopes: { business_unit: ['us'] } });

async function seedCase(id: string, businessUnitId: string, state = 'new') {
  await db.$transaction(async (tx) => {
    await enableAuditBypass(tx);
    await tx.kycCase.create({
      data: {
        id,
        reference: `KYC-${id}`,
        businessUnitId,
        customerName: `Customer ${id}`,
        ssn: '123456789',
        dob: new Date('1988-04-02'),
        address: '1 Example Way',
        nationality: 'US',
        riskScore: 40,
        state,
        slaDueAt: new Date('2030-01-01'),
      },
    });
  });
}

describe('generated views', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetRegistry();
    entry = registerResource({
      def: caseResource,
      path: 'kyc-cases',
      nav: 'Review queue',
      app: 'KYC',
      columns: [
        { field: 'reference', label: 'Case' },
        { field: 'ssn', label: 'SSN' },
      ],
      orderBy: { reference: 'asc' },
      titleField: 'reference',
    });
    await Promise.all([seedPrincipal(analyst), seedPrincipal(auditor), seedPrincipal(stranger)]);
    await seedCase('c1', 'us');
    await seedCase('c2', 'us');
    await seedCase('c3', 'eu');
  });

  describe('list', () => {
    it('applies scope as a query predicate, so the count is also scoped', async () => {
      const view = await listView(entry, analyst, { catalog });
      if (view.status !== 'ok') throw new Error(view.reason);

      expect(view.rows.map((row) => row.id)).toEqual(['c1', 'c2']);
      // Total must be the scoped total; a global count next to a scoped list is a leak.
      expect(view.total).toBe(2);
      expect(view.scope).toEqual({ dimension: 'business_unit', mode: 'scoped', values: ['us'] });
    });

    it('gives a global grant every record without a predicate', async () => {
      const view = await listView(entry, auditor, { catalog });
      if (view.status !== 'ok') throw new Error(view.reason);

      expect(view.total).toBe(3);
      expect(view.scope?.mode).toBe('global');
    });

    it('returns nothing — not everything — when the principal holds no grant', async () => {
      const view = await listView(entry, stranger, { catalog });
      expect(view.status).toBe('denied');
    });

    it('masks restricted columns in the list, not just on the detail screen', async () => {
      const view = await listView(entry, analyst, { catalog });
      if (view.status !== 'ok') throw new Error(view.reason);

      expect(view.rows[0].data.ssn).toBe('••••6789');
      expect(view.rows[0].masked).toContain('ssn');
      expect(JSON.stringify(view.rows)).not.toContain('123456789');
    });
  });

  describe('detail', () => {
    it('masks by default and records no read event for an unrevealed field', async () => {
      const view = await detailView(entry, 'c1', analyst, { catalog });
      if (view.status !== 'ok') throw new Error('expected ok');

      expect(view.row.data.ssn).toBe('••••6789');
      expect(view.revealable).toEqual(['ssn']);
      expect(view.revealed).toEqual([]);
      expect(await db.auditEvent.count({ where: { kind: 'read' } })).toBe(0);
    });

    it('audits a reveal with the field named, and the read shows in the record history', async () => {
      const view = await detailView(entry, 'c1', analyst, { catalog, reveal: ['ssn'] });
      if (view.status !== 'ok') throw new Error('expected ok');

      expect(view.row.data.ssn).toBe('123456789');
      expect(view.revealed).toEqual(['ssn']);

      const reads = await db.auditEvent.findMany({ where: { kind: 'read' } });
      expect(reads).toHaveLength(1);
      expect(reads[0]).toMatchObject({
        actorId: 'ana',
        resource: 'kyc_case',
        recordId: 'c1',
        fields: ['ssn'],
      });
    });

    it('refuses a reveal the principal cannot authorize, even when the URL asks for it', async () => {
      const view = await detailView(entry, 'c1', auditor, { catalog, reveal: ['ssn'] });
      if (view.status !== 'ok') throw new Error('expected ok');

      expect(view.row.data.ssn).toBe('••••6789');
      expect(view.revealable).toEqual([]);
      expect(await db.auditEvent.count({ where: { kind: 'read' } })).toBe(0);
    });

    it('denies an out-of-scope record and records the attempt', async () => {
      const view = await detailView(entry, 'c3', analyst, { catalog });
      expect(view.status).toBe('denied');

      const denials = await db.auditEvent.findMany({ where: { kind: 'auth_denied' } });
      expect(denials).toHaveLength(1);
      expect(denials[0]).toMatchObject({ actorId: 'ana', recordId: 'c3', action: 'read' });
    });

    it('reports a missing record without leaking whether it exists elsewhere', async () => {
      expect(await detailView(entry, 'nope', analyst, { catalog })).toEqual({ status: 'missing' });
    });
  });

  describe('action availability', () => {
    it('is decided server-side from permission and current state together', async () => {
      const view = await detailView(entry, 'c1', analyst, { catalog });
      if (view.status !== 'ok') throw new Error('expected ok');

      expect(view.row.actions).toEqual([
        { action: 'claim', available: true, requiresApproval: undefined },
        {
          action: 'reject',
          available: false,
          reason: 'no role held by ana grants kyc_case:decide',
        },
      ]);
    });

    it('closes an action the state machine does not allow from here', async () => {
      await seedCase('c4', 'us', 'in_review');
      const view = await detailView(entry, 'c4', analyst, { catalog });
      if (view.status !== 'ok') throw new Error('expected ok');

      expect(view.row.actions[0]).toEqual({
        action: 'claim',
        available: false,
        reason: 'only available while new',
      });
    });

    it('marks an available action that will park for approval', async () => {
      const officer = await seedPrincipal(
        principal({ id: 'omar', roles: ['analyst', 'officer'], scopes: { business_unit: ['us'] } }),
      );
      const withDecide: PolicyCatalog = {
        ...catalog,
        roles: [
          ...catalog.roles,
          {
            name: 'officer',
            description: 'Decides cases.',
            grant: 'own_scope',
            permissions: ['kyc_case:decide'],
          },
        ],
      };
      await seedCase('c5', 'us', 'in_review');

      const view = await detailView(entry, 'c5', officer, { catalog: withDecide });
      if (view.status !== 'ok') throw new Error('expected ok');

      expect(view.row.actions.find((action) => action.action === 'reject')).toEqual({
        action: 'reject',
        available: true,
        requiresApproval: 'compliance',
      });
    });
  });

  describe('a parked approval on a record', () => {
    async function park(requesterId: string) {
      await db.approvalRequest.create({
        data: {
          id: 'req-1',
          resource: 'kyc_case',
          recordId: 'c1',
          action: 'reject',
          payload: {},
          policy: 'compliance',
          requiredApprovers: 1,
          eligibleRoles: ['compliance_officer'],
          excludeRequester: true,
          requesterId,
          requestId: 'rq-1',
        },
      });
    }

    it('is offered to an eligible approver', async () => {
      await park('someone_else');
      const officer = await seedPrincipal(
        principal({
          id: 'omar',
          roles: ['analyst', 'compliance_officer'],
          scopes: { business_unit: ['us'] },
        }),
      );

      const view = await detailView(entry, 'c1', officer, { catalog });
      if (view.status !== 'ok') throw new Error('expected ok');
      expect(view.pendingApprovals[0].decidable).toEqual({ available: true });
    });

    it('is shown but not offered to the requester, so the button cannot precede the refusal', async () => {
      await park(analyst.id);

      const view = await detailView(entry, 'c1', analyst, { catalog });
      if (view.status !== 'ok') throw new Error('expected ok');
      expect(view.pendingApprovals[0].decidable).toEqual({
        available: false,
        reason: 'you requested this change; a different person must approve it',
      });
    });

    it('is not offered to a principal without an eligible role, however global their read', async () => {
      await park('someone_else');

      const view = await detailView(entry, 'c1', auditor, { catalog });
      if (view.status !== 'ok') throw new Error('expected ok');
      expect(view.pendingApprovals[0].decidable).toEqual({
        available: false,
        reason: 'approval requires one of: compliance_officer',
      });
    });
  });
});
