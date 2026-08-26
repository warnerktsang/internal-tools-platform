import { switchPrincipal } from '@/app/actions';
import { Badge } from '@/components/ui/primitives';
import type { Principal } from '@/substrate/types';

/**
 * Acting as someone else is a page load, not a login — which makes separation of duties
 * visible: switching is the only way to satisfy `excludeRequester`.
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
    <form action={switchPrincipal} className="flex items-center gap-2">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="text-xs uppercase tracking-wide text-neutral-500" htmlFor="principalId">
        Acting as
      </label>
      <select
        id="principalId"
        name="principalId"
        defaultValue={current?.id ?? ''}
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
      <button
        type="submit"
        className="rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50"
      >
        Switch
      </button>
      {current ? (
        <span className="ml-2 flex items-center gap-1">
          {Object.entries(current.scopes).map(([dimension, values]) => (
            <Badge key={dimension} tone="slate">
              {dimension}: {(values ?? []).join(', ')}
            </Badge>
          ))}
        </span>
      ) : null}
    </form>
  );
}
