import { ChevronsUpDown, UserRound } from 'lucide-react';
import { switchPrincipal } from '@/app/actions';
import { PrincipalSelect } from '@/components/principal-select';
import type { Principal } from '@/substrate/types';

/**
 * Pinned at the top of the sidebar, where a console puts the context everything below it is
 * read through — because that is what it is. Acting as someone else is a page load, not a
 * login, which makes separation of duties visible: switching is the only way to satisfy
 * `excludeRequester`.
 */
export function PrincipalSwitcher({
  principals,
  current,
  returnTo,
}: {
  principals: Principal[];
  current: Principal | null;
  returnTo: string;
}) {
  return (
    <form action={switchPrincipal}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="relative flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 shadow-sm focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-100">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-700">
          <UserRound className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase tracking-wide text-neutral-500">
            Acting as
          </span>
          <span className="block truncate text-sm font-medium text-neutral-900">
            {current ? current.displayName : 'Select a principal'}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
        <PrincipalSelect principals={principals} current={current} />
      </div>
      {current ? (
        <p className="mt-1.5 px-1 text-xs leading-relaxed text-neutral-500">
          {current.roles.join(' · ') || 'no roles'}
          {Object.entries(current.scopes).map(([dimension, values]) => (
            <span key={dimension} className="block text-neutral-400">
              {dimension}: {(values ?? []).join(', ')}
            </span>
          ))}
        </p>
      ) : null}
    </form>
  );
}
