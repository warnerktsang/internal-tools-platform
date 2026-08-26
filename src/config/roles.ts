/**
 * APP CONFIGURATION, not substrate.
 *
 * The substrate knows how to resolve roles to permissions, honour scope grants and
 * evaluate deny rules. It has no opinion about which roles exist. That list lives here:
 * versioned, diffable and reviewable in a pull request, rather than edited in a
 * production admin UI where nobody sees the change.
 */
import type { DenyRule, Role } from '@/substrate/types';

export const ROLES: Role[] = [
  {
    name: 'kyc_analyst',
    description: 'Reviews KYC cases for their own business unit.',
    grant: 'own_scope',
    permissions: [
      'kyc_case:read',
      'kyc_case:reveal_pii',
      'kyc_case:assign',
      'kyc_case:decide',
      'kyc_case:export',
    ],
  },
  {
    name: 'compliance_officer',
    description: 'Approves KYC rejections and escalations across all business units.',
    grant: 'global',
    permissions: [
      'kyc_case:read',
      'kyc_case:reveal_pii',
      // The substrate's approval engine always checks `<resource>:approve`.
      'kyc_case:approve',
      'audit_event:read',
    ],
  },
  {
    name: 'auditor',
    description: 'Read-only visibility across every app, for every business unit.',
    grant: 'global',
    permissions: [
      'kyc_case:read',
      'kyc_case:export',
      'refund:read',
      'flag_config:read',
      'audit_event:read',
    ],
  },
  {
    name: 'support_agent',
    description: 'Requests refunds for their own business unit.',
    grant: 'own_scope',
    permissions: ['refund:read', 'refund:request', 'payment:read'],
  },
  {
    name: 'finance_manager',
    description: 'Approves refunds above the auto-approval threshold.',
    grant: 'own_scope',
    permissions: ['refund:read', 'refund:request', 'refund:approve', 'payment:read', 'refund:export'],
  },
  {
    name: 'engineer',
    description: 'Changes feature flags in the environments they are granted.',
    grant: 'own_scope',
    permissions: ['flag_config:read', 'flag_config:update', 'flag_config:rollback'],
  },
  {
    /**
     * Effect workers reporting an external outcome back into the domain. They act through
     * the same operation gateway as a human, so their writes are authorized and audited —
     * which means they need a role, and a narrow one.
     */
    name: 'system_effects',
    description: 'System principals settling external outcomes.',
    grant: 'global',
    permissions: ['refund:settle', 'flag_config:publish'],
  },
  {
    name: 'release_manager',
    description: 'Changes and approves feature-flag rollouts, including production.',
    grant: 'own_scope',
    permissions: [
      'flag_config:read',
      'flag_config:update',
      'flag_config:rollback',
      'flag_config:approve',
    ],
  },
];

/**
 * Evaluated after permissions, and deny always wins. This is the capability an
 * additive-only role model (Dataverse, most RBAC-by-config products) cannot express:
 * there is no way to say "this role grants read everywhere, and yet never this".
 */
export const DENY_RULES: DenyRule[] = [
  {
    name: 'auditor_never_reveals_pii',
    reason: 'Auditors have read-only visibility everywhere and may never reveal raw PII.',
    when: ({ principal, action }) =>
      principal.roles.includes('auditor') && action === 'reveal_pii',
  },
  {
    name: 'production_flag_change_requires_release_manager',
    reason: 'Production flag changes are restricted to release managers.',
    // Scoped to humans: the publish effect writes back as a system principal, and denying
    // that would strand every approved production change in 'publishing'.
    when: ({ principal, resource, action, record }) =>
      principal.kind === 'human' &&
      resource === 'flag_config' &&
      action !== 'read' &&
      record?.scopeValue === 'production' &&
      !principal.roles.includes('release_manager'),
  },
];
