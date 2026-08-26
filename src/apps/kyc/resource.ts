/**
 * The KYC review queue: everything here is domain meaning, and nothing here is machinery.
 *
 * What the app owns and the substrate deliberately does not:
 *   - which fields are PII, how each one masks, and which permission reveals it — the
 *     substrate applies the policy, the app decides what is sensitive;
 *   - a case is decided by the analyst who claimed it, and only while they hold it;
 *   - a decision without a reason is not a decision, and the reason is what the approver
 *     and the auditor read later;
 *   - identity evidence must exist before a case can be approved;
 *   - rejecting a customer always needs compliance sign-off; approving a high-risk one
 *     does too. Both are declared as data, with different `appliesWhen`.
 */
import { defineResource } from '@/substrate/resource';
import { invalid } from '@/substrate/types';
import type { GuardContext } from '@/substrate/types';

export type KycCaseRow = {
  id: string;
  reference: string;
  businessUnitId: string;
  customerName: string;
  ssn: string;
  dob: Date;
  address: string;
  nationality: string;
  riskScore: number;
  state: string;
  assigneeId: string | null;
  decisionReason: string | null;
  slaDueAt: Date;
};

/** At or above this, approving a customer is a compliance decision, not an analyst's. */
export const HIGH_RISK_SCORE = 70;

const MIN_REASON_LENGTH = 10;

/**
 * Four-eyes at the record level: the queue exists so that one named analyst owns a case.
 * Holding the case is a domain precondition for deciding it, distinct from the permission
 * to decide at all — which is why it is a guard and not a role.
 */
function assertHeldByDecider({ record, principal }: GuardContext<KycCaseRow>): void {
  if (record.assigneeId === null) {
    invalid('claim the case before deciding it', 'assigneeId');
  }
  if (record.assigneeId !== principal.id) {
    invalid(`the case is claimed by ${record.assigneeId}; only they can decide it`, 'assigneeId');
  }
}

function reasonFrom({ payload }: GuardContext<KycCaseRow>): string {
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (reason.length < MIN_REASON_LENGTH) {
    invalid(
      `record why: a decision reason of at least ${MIN_REASON_LENGTH} characters is kept with the case`,
      'reason',
    );
  }
  return reason;
}

export const kycCaseResource = defineResource<KycCaseRow>({
  name: 'kyc_case',
  table: 'kyc_cases',
  label: 'KYC case',
  delegate: (tx) => tx.kycCase,
  scope: { dimension: 'business_unit', field: 'businessUnitId' },
  /**
   * A masked value never reaches the browser: `project()` replaces it server-side, and a
   * reveal is a separate authorized, audited read.
   */
  fields: {
    ssn: { sensitivity: 'restricted', mask: 'last4', revealPermission: 'kyc_case:reveal_pii' },
    dob: { sensitivity: 'restricted', mask: 'date_year', revealPermission: 'kyc_case:reveal_pii' },
    address: { sensitivity: 'sensitive', mask: 'partial', revealPermission: 'kyc_case:reveal_pii' },
  },
  machine: {
    initial: 'new',
    states: ['new', 'in_review', 'info_requested', 'escalated', 'approved', 'rejected'],
    transitions: [
      {
        action: 'claim',
        from: ['new', 'info_requested'],
        to: 'in_review',
        permission: 'kyc_case:assign',
        /**
         * No "already claimed" guard: a claimed case is `in_review`, and the state check
         * refuses it first. `release` and `request_info` both clear the assignee, so the
         * claimable states are exactly the unassigned ones — and the row is locked, so two
         * analysts cannot both pass that check.
         */
        apply: ({ principal }) => ({ assigneeId: principal.id }),
      },
      {
        action: 'release',
        from: ['in_review'],
        to: 'new',
        permission: 'kyc_case:assign',
        guard: assertHeldByDecider,
        apply: () => ({ assigneeId: null }),
      },
      {
        action: 'request_info',
        from: ['in_review'],
        to: 'info_requested',
        permission: 'kyc_case:decide',
        guard: (ctx) => {
          assertHeldByDecider(ctx);
          reasonFrom(ctx);
        },
        // Released back to the queue: whoever picks the answer up need not be the asker.
        apply: (ctx) => ({ decisionReason: reasonFrom(ctx), assigneeId: null }),
      },
      {
        action: 'approve',
        from: ['in_review', 'escalated'],
        to: 'approved',
        permission: 'kyc_case:decide',
        requiresApproval: 'high_risk',
        guard: async (ctx) => {
          assertHeldByDecider(ctx);
          reasonFrom(ctx);
          const documents = await ctx.tx.kycDocument.count({
            where: { caseId: ctx.record.id, kind: 'identity' },
          });
          if (documents === 0) {
            invalid('no identity document is on file; approving would be unevidenced', 'documents');
          }
        },
        apply: (ctx) => ({ decisionReason: reasonFrom(ctx) }),
      },
      {
        action: 'escalate',
        from: ['in_review'],
        to: 'escalated',
        permission: 'kyc_case:decide',
        guard: (ctx) => {
          assertHeldByDecider(ctx);
          reasonFrom(ctx);
        },
        apply: (ctx) => ({ decisionReason: reasonFrom(ctx) }),
      },
      {
        action: 'reject',
        from: ['in_review', 'escalated'],
        to: 'rejected',
        permission: 'kyc_case:decide',
        // Refusing a customer is never a single analyst's call.
        requiresApproval: 'compliance',
        guard: (ctx) => {
          assertHeldByDecider(ctx);
          reasonFrom(ctx);
        },
        apply: (ctx) => ({ decisionReason: reasonFrom(ctx) }),
      },
    ],
  },
  approvals: {
    compliance: {
      name: 'compliance',
      rules: [{ appliesWhen: () => true, approvers: 1, eligibleRoles: ['compliance_officer'] }],
      exclusions: { excludeRequester: true },
    },
    high_risk: {
      name: 'high_risk',
      rules: [
        {
          appliesWhen: (record) => Number(record.riskScore) >= HIGH_RISK_SCORE,
          approvers: 1,
          eligibleRoles: ['compliance_officer'],
        },
      ],
      exclusions: { excludeRequester: true },
    },
  },
});
