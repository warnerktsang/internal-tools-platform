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
