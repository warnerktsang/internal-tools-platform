/**
 * The one thing KYC needs that generation cannot supply: a decision carries a reason, and a
 * generic action button has nowhere to type one. Thin by construction — collect the reason,
 * hand it to `execute()` as the payload, and let the substrate authorize, guard, park for
 * approval and audit.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { kycCaseResource } from '@/apps/kyc/resource';
import { operationQuery } from '@/lib/operation-query';
import { execute } from '@/substrate/operations';
import { requirePrincipal } from '@/substrate/session';

export async function decideCase(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const recordId = String(formData.get('recordId') ?? '');
  const back = `/r/kyc-cases/${recordId}`;

  const result = await execute({
    resource: kycCaseResource,
    action: String(formData.get('action') ?? ''),
    recordId,
    principal,
    // The reason is validated in the resource's guard, not here: a decision submitted by
    // any other route must fail the same way.
    payload: { reason: String(formData.get('reason') ?? '') },
  });

  revalidatePath(back);
  redirect(`${back}?${operationQuery(result)}`);
}
