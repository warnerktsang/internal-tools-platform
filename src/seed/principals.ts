/**
 * The demo cast, kept to the smallest set that can still reach every path: one principal per
 * app, plus the second signer each countersigned flow requires, plus an auditor. Roles and
 * scopes are database rows, so the policy engine treats these exactly as it would principals
 * from a real IdP — only the login is fake.
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
    id: 'usr-priya',
    kind: 'human',
    email: 'priya@example.com',
    displayName: 'Priya Nair',
    title: 'Finance manager, Consumer',
    roles: ['finance_manager'],
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
    // Global by role, not by scope grant: compliance signs off everywhere.
    id: 'usr-omar',
    kind: 'human',
    email: 'omar@example.com',
    displayName: 'Omar Diallo',
    title: 'Compliance officer',
    roles: ['compliance_officer'],
    scopes: {},
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
    id: 'usr-rel',
    kind: 'human',
    email: 'rel@example.com',
    displayName: 'Renee Lindqvist',
    title: 'Release manager',
    roles: ['release_manager'],
    scopes: { environment: ['development', 'staging', 'production'] },
  },
  {
    // A second release manager: production ramps above the threshold need someone other
    // than the person who proposed them.
    id: 'usr-mira',
    kind: 'human',
    email: 'mira@example.com',
    displayName: 'Mira Kovács',
    title: 'Release manager, Platform',
    roles: ['release_manager'],
    scopes: { environment: ['development', 'staging', 'production'] },
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
