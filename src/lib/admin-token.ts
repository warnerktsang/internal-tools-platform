/**
 * Shared guard for the two operational routes (reseed, effect sweep).
 *
 * The demo has no authentication by design — switching principals *is* the demo — but
 * wiping the shared database or draining the outbox are not things a visitor should be able
 * to do by guessing a URL. So these two routes, and only these two, require a token, and
 * they refuse to run at all if one was never configured.
 */
import { NextResponse } from 'next/server';

const HEADER = 'authorization';

function provided(request: Request): string | null {
  const header = request.headers.get(HEADER);
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return new URL(request.url).searchParams.get('token');
}

/** Returns a response to send when the request may not proceed, or null when it may. */
export function authorizeAdminRequest(request: Request): NextResponse | null {
  // CRON_SECRET is what Vercel Cron sends as a bearer token; ADMIN_TOKEN is for calling
  // these routes by hand. Either satisfies both routes.
  const accepted = [process.env.ADMIN_TOKEN, process.env.CRON_SECRET].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (accepted.length === 0) {
    return NextResponse.json(
      { error: 'neither ADMIN_TOKEN nor CRON_SECRET is configured' },
      { status: 503 },
    );
  }
  const token = provided(request);
  if (token === null || !accepted.includes(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
