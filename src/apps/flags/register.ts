/**
 * The flags app's whole integration surface: one registration and one port. The rollback
 * button is generated (no payload), the config change is a panel (it has one).
 */
import { registerPort } from '@/substrate/effects';
import { registerResource } from '@/substrate/registry';
import { flagConfigResource } from '@/apps/flags/resource';
import { RolloutPanel } from '@/apps/flags/rollout-panel';
import { flagServicePort } from '@/apps/flags/service';

export function registerFlags(): void {
  registerResource({
    def: flagConfigResource,
    path: 'flag-configs',
    nav: 'Flags',
    app: 'Feature flags',
    titleField: 'environment',
    orderBy: { updatedAt: 'desc' },
    columns: [
      // The flag id is human-readable in the seed, which is cheaper than teaching the
      // registry to join.
      { field: 'flagId', label: 'Flag' },
      { field: 'environment', label: 'Environment' },
      { field: 'enabled', label: 'Enabled' },
      { field: 'rolloutPct', label: 'Rollout %' },
      { field: 'version', label: 'Version' },
      { field: 'publishedVersion', label: 'Live version' },
      { field: 'state', label: 'State', format: 'state' },
    ],
    detailPanel: RolloutPanel,
    panelActions: ['update'],
  });

  registerPort(flagServicePort);
}
