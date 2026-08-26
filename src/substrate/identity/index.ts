/**
 * The authentication seam.
 *
 * Everything above this file deals in `Principal`. Nothing above it knows whether the
 * principal came from a seeded row, an OIDC id token or a service account, which is what
 * makes "authentication is stubbed, authorization is real" an accurate description rather
 * than an excuse.
 */
import { cookies } from 'next/headers';
import { db } from '@/substrate/db';
import type { IdentityProvider, Principal, ScopeDimension } from '@/substrate/types';

const PRINCIPAL_COOKIE = 'itp_principal';

type PrincipalRow = {
  id: string;
  kind: string;
  email: string | null;
  displayName: string;
  title: string | null;
  roles: string[];
  scopes: unknown;
};

/** Narrows the untyped `scopes` JSON column without trusting its shape. */
export function parseScopes(value: unknown): Partial<Record<ScopeDimension, string[]>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<ScopeDimension, string[]>> = {};
  for (const dimension of ['business_unit', 'environment'] as ScopeDimension[]) {
    const raw = (value as Record<string, unknown>)[dimension];
    if (Array.isArray(raw)) out[dimension] = raw.filter((v): v is string => typeof v === 'string');
  }
  return out;
}

export function toPrincipal(row: PrincipalRow): Principal {
  return {
    id: row.id,
    kind: row.kind === 'system' ? 'system' : 'human',
    email: row.email,
    displayName: row.displayName,
    title: row.title,
    roles: row.roles,
    scopes: parseScopes(row.scopes),
  };
}

/**
 * Demo identity provider: the current principal is whichever seeded row the switcher
 * cookie names. Roles and scopes still come from the database, and every downstream
 * decision is made by the real policy engine.
 *
 * The cookie is unauthenticated, so it is treated as a claim about *which human* is
 * browsing, never as proof of anything: a request may only ever authenticate as a human.
 * System principals exist to attribute background work and hold permissions no human has
 * (settling refunds, publishing flag configs), so a hand-written cookie naming one must
 * not become a session.
 */
export const seededIdentityProvider: IdentityProvider = {
  name: 'seeded',
  async getPrincipal() {
    const store = await cookies();
    const id = store.get(PRINCIPAL_COOKIE)?.value;
    if (!id) return null;
    const principal = await getPrincipalById(id);
    return principal?.kind === 'human' ? principal : null;
  },
};

export async function getPrincipalById(id: string): Promise<Principal | null> {
  const row = await db.principal.findUnique({ where: { id } });
  return row ? toPrincipal(row) : null;
}

/**
 * Background work still has an actor. Webhooks, the effect worker and reconciliation run
 * as system principals so the trail never contains an unattributed mutation.
 */
export async function systemPrincipal(id: string): Promise<Principal> {
  const principal = await getPrincipalById(id);
  if (!principal) throw new Error(`system principal '${id}' is not seeded`);
  if (principal.kind !== 'system') throw new Error(`principal '${id}' is not a system principal`);
  return principal;
}

export { PRINCIPAL_COOKIE };
