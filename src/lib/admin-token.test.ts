/**
 * The two operational routes are the only unauthenticated-by-design surface that can destroy
 * state, so the guard's failure modes matter more than its success one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { authorizeAdminRequest } from '@/lib/admin-token';

const url = 'https://demo.example.com/api/demo/reseed';

function request(init?: { bearer?: string; query?: string }): Request {
  const target = init?.query === undefined ? url : `${url}?token=${init.query}`;
  return new Request(target, {
    headers: init?.bearer === undefined ? {} : { authorization: `Bearer ${init.bearer}` },
  });
}

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
  delete process.env.CRON_SECRET;
});

describe('the operational route guard', () => {
  it('refuses to run when no token is configured, rather than running openly', async () => {
    const refusal = authorizeAdminRequest(request({ bearer: 'anything' }));
    expect(refusal?.status).toBe(503);
  });

  it('rejects a missing or wrong token', async () => {
    process.env.ADMIN_TOKEN = 'right';
    expect(authorizeAdminRequest(request())?.status).toBe(401);
    expect(authorizeAdminRequest(request({ bearer: 'wrong' }))?.status).toBe(401);
    expect(authorizeAdminRequest(request({ query: 'wrong' }))?.status).toBe(401);
  });

  it('accepts the admin token as a bearer or a query parameter', () => {
    process.env.ADMIN_TOKEN = 'right';
    expect(authorizeAdminRequest(request({ bearer: 'right' }))).toBeNull();
    expect(authorizeAdminRequest(request({ query: 'right' }))).toBeNull();
  });

  it("accepts Vercel Cron's CRON_SECRET, so the sweep needs no second variable", () => {
    process.env.CRON_SECRET = 'cron';
    expect(authorizeAdminRequest(request({ bearer: 'cron' }))).toBeNull();
    expect(authorizeAdminRequest(request({ bearer: 'right' }))?.status).toBe(401);
  });
});
