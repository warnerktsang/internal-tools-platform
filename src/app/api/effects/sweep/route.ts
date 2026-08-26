/**
 * Recovery sweep for the outbox.
 *
 * Effects are run by the operation that enqueued them, so nothing in the request path needs
 * this. What needs it is a row whose process died between the commit and the provider call:
 * the intent is durable, but no caller is left to settle it. Vercel Cron hits this route.
 */
import { NextResponse } from 'next/server';
import '@/apps/register';
import { runEffects } from '@/substrate/effects';
import { authorizeAdminRequest } from '@/lib/admin-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const refusal = authorizeAdminRequest(request);
  if (refusal) return refusal;

  const results = await runEffects();
  return NextResponse.json({
    swept: results.length,
    outcomes: results.map((result) => ({ effectId: result.effectId, outcome: result.outcome })),
  });
}

export const POST = GET;
