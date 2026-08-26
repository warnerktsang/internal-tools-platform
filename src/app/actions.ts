/**
 * The only way the UI reaches domain state: a server action that resolves the resource
 * from the registry and hands it to `execute()`. There is no per-app route, and no client
 * code path that could skip authorization.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { decide } from '@/substrate/approvals';
import { runEffects } from '@/substrate/effects';
import { PRINCIPAL_COOKIE } from '@/substrate/identity';
import { execute } from '@/substrate/operations';
import { resourceByName } from '@/substrate/registry';
import { requirePrincipal } from '@/substrate/session';
import type { OperationResult } from '@/substrate/types';

function outcomeQuery(result: OperationResult<unknown>): string {
  const params = new URLSearchParams({ status: result.status });
  if (result.status === 'denied' || result.status === 'invalid' || result.status === 'unknown') {
    params.set('message', result.reason);
  }
  if (result.status === 'pending') params.set('message', `policy: ${result.policy}`);
  if (result.status === 'unknown') params.set('reference', `effect ${result.effectId}`);
  if (result.status === 'pending') params.set('reference', `approval ${result.approvalRequestId}`);
  return params.toString();
}

function payloadFrom(formData: FormData): Record<string, unknown> {
  const raw = formData.get('payload');
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  const parsed: unknown = JSON.parse(raw);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export async function switchPrincipal(formData: FormData): Promise<void> {
  const id = String(formData.get('principalId') ?? '');
  const store = await cookies();
  store.set(PRINCIPAL_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect(String(formData.get('returnTo') ?? '/'));
}

export async function runAction(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const resourceName = String(formData.get('resource') ?? '');
  const entry = resourceByName(resourceName);
  if (!entry) throw new Error(`resource '${resourceName}' is not registered`);

  const result = await execute({
    resource: entry.def,
    action: String(formData.get('action') ?? ''),
    recordId: String(formData.get('recordId') ?? ''),
    principal,
    payload: payloadFrom(formData),
  });

  const path = `/r/${entry.path}/${String(formData.get('recordId') ?? '')}`;
  revalidatePath(path);
  redirect(`${path}?${outcomeQuery(result)}`);
}

export async function decideApproval(formData: FormData): Promise<void> {
  const approver = await requirePrincipal();
  const resourceName = String(formData.get('resource') ?? '');
  const entry = resourceByName(resourceName);
  if (!entry) throw new Error(`resource '${resourceName}' is not registered`);

  const outcome = await decide({
    resource: entry.def,
    approvalRequestId: String(formData.get('approvalRequestId') ?? ''),
    approver,
    decision: formData.get('decision') === 'rejected' ? 'rejected' : 'approved',
    note: String(formData.get('note') ?? '') || undefined,
  });

  const path = `/r/${entry.path}/${String(formData.get('recordId') ?? '')}`;
  revalidatePath(path);

  if (outcome.status === 'applied') redirect(`${path}?${outcomeQuery(outcome.result)}`);
  const params = new URLSearchParams({ decision: outcome.status });
  if (outcome.status === 'denied' || outcome.status === 'invalid') {
    params.set('message', outcome.reason);
  }
  redirect(`${path}?${params.toString()}`);
}

/** In production this is a queue consumer; in the prototype the demo drains it explicitly. */
export async function drainEffects(formData: FormData): Promise<void> {
  const results = await runEffects();
  const returnTo = String(formData.get('returnTo') ?? '/');
  revalidatePath(returnTo);
  redirect(`${returnTo}?effects=${results.length}`);
}
