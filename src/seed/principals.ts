/**
 * The demo cast. Roles and scopes are database rows, so the policy engine treats these
 * exactly as it would principals from a real IdP — only the login is fake.
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
    id: 'usr-dan',
    kind: 'human',
    email: 'dan@example.com',
    displayName: 'Dan Whitfield',
    title: 'Support agent, SMB',
    roles: ['support_agent'],
    scopes: { business_unit: ['bu-smb'] },
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
    id: 'usr-raj',
    kind: 'human',
    email: 'raj@example.com',
    displayName: 'Raj Patel',
    title: 'KYC analyst, SMB',
    roles: ['kyc_analyst'],
    scopes: { business_unit: ['bu-smb'] },
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
];
