import { switchPrincipal } from '@/app/actions';
import { PrincipalSelect } from '@/components/principal-select';
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
      <PrincipalSelect principals={principals} current={current} />
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
