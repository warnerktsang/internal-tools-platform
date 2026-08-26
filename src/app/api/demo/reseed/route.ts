/**
 * Resets the shared demo.
 *
 * Visitors mutate state — approvals get consumed, flags get ramped — so a hosted link needs
 * a way back to the starting position. This runs the same seed the CLI does, which means the
 * reset states are produced by real operations and the audit trail stays genuine.
 */
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import '@/apps/register';
import { authorizeAdminRequest } from '@/lib/admin-token';
import { seedDemoData } from '@/seed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const refusal = authorizeAdminRequest(request);
  if (refusal) return refusal;

  const summary = await seedDemoData();
  revalidatePath('/', 'layout');
  return NextResponse.json(summary);
}

export const GET = POST;
