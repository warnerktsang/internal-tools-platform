'use client';

import type { Principal } from '@/substrate/types';

/**
 * Submits on change so acting as someone else is one interaction. Without JavaScript the
 * enclosing form still posts, so the switcher degrades to a plain select plus Enter.
 */
export function PrincipalSelect({
  principals,
  current,
}: {
  principals: Principal[];
  current: Principal | null;
}) {
  return (
    <select
      id="principalId"
      name="principalId"
      defaultValue={current?.id ?? ''}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
      className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
    >
      <option value="" disabled>
        Select a principal
      </option>
      {principals.map((principal) => (
        <option key={principal.id} value={principal.id}>
          {principal.displayName} — {principal.roles.join(', ') || 'no roles'}
        </option>
      ))}
    </select>
  );
}
