import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const { PRINCIPAL_COOKIE, seededIdentityProvider } = await import('@/substrate/identity');
const { resetDatabase, seedPrincipal, principal } = await import('@/test/db');

describe('seeded identity provider', () => {
  beforeEach(async () => {
    cookieJar.clear();
    await resetDatabase();
    await seedPrincipal(principal({ id: 'usr-nadia', roles: ['kyc_analyst'] }));
    await seedPrincipal(
      principal({ id: 'sys-refund-settler', kind: 'system', roles: ['system_effects'] }),
    );
  });

  it('authenticates the human the switcher cookie names', async () => {
    cookieJar.set(PRINCIPAL_COOKIE, 'usr-nadia');
    const resolved = await seededIdentityProvider.getPrincipal();
    expect(resolved?.id).toBe('usr-nadia');
    expect(resolved?.roles).toEqual(['kyc_analyst']);
  });

  it('refuses to authenticate as a system principal', async () => {
    // The cookie is unauthenticated, so it is a claim about which human is browsing. System
    // principals hold permissions no human has (settling refunds, publishing flag configs),
    // so a hand-written cookie naming one must not become a session.
    cookieJar.set(PRINCIPAL_COOKIE, 'sys-refund-settler');
    expect(await seededIdentityProvider.getPrincipal()).toBeNull();
  });

  it('has no principal when the cookie is absent or names nobody', async () => {
    expect(await seededIdentityProvider.getPrincipal()).toBeNull();
    cookieJar.set(PRINCIPAL_COOKIE, 'usr-nobody');
    expect(await seededIdentityProvider.getPrincipal()).toBeNull();
  });
});
