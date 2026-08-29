/**
 * The demo cast: one principal per app, one approver who countersigns for all three, and an
 * auditor. Roles and scopes are database rows, so the policy engine treats these exactly as it
 * would principals from a real IdP — only the login is fake.
 *
 * Omar holding three roles is a demo compression, not a recommendation: a real deployment would
 * spread them across people. It is safe here only because separation of duties is enforced per
 * request, so he still cannot approve anything he asked for himself.
 */
import type { Principal } from '@/substrate/types';

export const DEMO_PRINCIPALS: Principal[] = [
  {
    id: 'usr-sofia',
    kind: 'human',
    email: 'sofia@example.com',
    displayName: 'Sofia Ramos',
    title: 'Support agent, Consumer',
    roles: ['support_agent'],
    scopes: { business_unit: ['bu-consumer'] },
  },
  {
    id: 'usr-nadia',
    kind: 'human',
    email: 'nadia@example.com',
    displayName: 'Nadia Haddad',
    title: 'KYC analyst, Consumer',
    roles: ['kyc_analyst'],
    scopes: { business_unit: ['bu-consumer'] },
  },
  {
    // The second signer for all three apps. compliance_officer is global by role; the other two
    // are own_scope roles, so they need explicit grants like anyone else's.
    id: 'usr-omar',
    kind: 'human',
    email: 'omar@example.com',
    displayName: 'Omar Diallo',
    title: 'Compliance officer',
    roles: ['compliance_officer', 'finance_manager', 'release_manager'],
    scopes: {
      business_unit: ['bu-consumer'],
      environment: ['development', 'staging', 'production'],
    },
  },
  {
    // Flags scope by environment, so a principal's grant names environments rather than
    // business units — the same mechanism, a different dimension.
    id: 'usr-sam',
    kind: 'human',
    email: 'sam@example.com',
    displayName: 'Sam Okafor',
    title: 'Engineer, Growth',
    roles: ['engineer'],
    scopes: { environment: ['development', 'staging'] },
  },
  {
    id: 'usr-ava',
    kind: 'human',
    email: 'ava@example.com',
    displayName: 'Ava Chen',
    title: 'Internal auditor',
    roles: ['auditor'],
    scopes: {},
  },
];

export const DEMO_SYSTEM_PRINCIPALS: Principal[] = [
  {
    id: 'sys-refund-settler',
    kind: 'system',
    email: null,
    displayName: 'Refund settler (effect worker)',
    title: 'System',
    roles: ['system_effects'],
    scopes: {},
  },
  {
    id: 'sys-flag-publisher',
    kind: 'system',
    email: null,
    displayName: 'Flag publisher (effect worker)',
    title: 'System',
    roles: ['system_effects'],
    scopes: {},
  },
];
