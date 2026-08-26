/**
 * The one thing generation cannot supply for flags: a config change carries a payload —
 * the new rollout, and the version it was written against. Everything else (authorization,
 * the production deny rule, the approval, the audit row, the publish effect) is substrate.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { flagConfigResource } from '@/apps/flags/resource';
import { operationQuery } from '@/lib/operation-query';
import { execute } from '@/substrate/operations';
import { requirePrincipal } from '@/substrate/session';

export async function changeRollout(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const recordId = String(formData.get('recordId') ?? '');
  const path = `/r/flag-configs/${recordId}`;

  const result = await execute({
    resource: flagConfigResource,
    action: 'update',
    recordId,
    principal,
    payload: {
      enabled: formData.get('enabled') === 'on',
      rolloutPct: Number(formData.get('rolloutPct')),
      // The version the form was rendered from: a change is applied only against the
      // baseline whoever wrote it (and whoever approved it) actually saw.
      expectedVersion: Number(formData.get('expectedVersion')),
    },
  });

  revalidatePath(path);
  redirect(`${path}?${operationQuery(result)}`);
}
