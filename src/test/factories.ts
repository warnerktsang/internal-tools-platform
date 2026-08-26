import type { Principal } from '@/substrate/types';

export function principal(overrides: Partial<Principal> & { id: string }): Principal {
  return {
    kind: 'human',
    email: `${overrides.id}@example.test`,
    displayName: overrides.id,
    title: null,
    roles: [],
    scopes: {},
    ...overrides,
  };
}
