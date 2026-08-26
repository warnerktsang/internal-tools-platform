/**
 * Request-scoped identity. Authentication is seeded (a signed-out demo has no SSO), but
 * every principal it returns carries real roles and scopes from the database, and every
 * decision below this line is made by the real policy engine.
 */
import { db } from '@/substrate/db';
import { seededIdentityProvider, toPrincipal } from '@/substrate/identity';
import type { Principal } from '@/substrate/types';

export async function currentPrincipal(): Promise<Principal | null> {
  return seededIdentityProvider.getPrincipal();
}

export async function requirePrincipal(): Promise<Principal> {
  const principal = await currentPrincipal();
  if (!principal) throw new Error('no principal selected');
  return principal;
}

/** The switcher's options: the seeded humans. System principals are not selectable. */
export async function selectablePrincipals(): Promise<Principal[]> {
  const rows = await db.principal.findMany({
    where: { kind: 'human' },
    orderBy: { displayName: 'asc' },
  });
  return rows.map(toPrincipal);
}
