'use client';

import type { Principal } from '@/substrate/types';

/**
 * Submits on change so acting as someone else is one interaction. Without JavaScript the
 * enclosing form still posts, so the switcher degrades to a plain select plus Enter.
 *
 * Rendered transparently over the switcher card: the native select keeps the keyboard and
 * mobile behaviour, the card underneath carries the styling.
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
      aria-label="Acting as"
      defaultValue={current?.id ?? ''}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
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
