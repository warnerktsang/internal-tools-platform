/**
 * The resource registry.
 *
 * An app registers a resource definition plus the small amount of presentation data the
 * generated screens need (a URL segment, a nav label, which columns to show). Navigation,
 * list, detail and history screens are then derived — there is no per-app CRUD page, which
 * is the whole reason apps 4..n are cheap.
 */
import type { ComponentType } from 'react';
import type { ResourceDefinition } from '@/substrate/resource';
import type { AvailableAction } from '@/substrate/views';

export type Column = {
  field: string;
  label: string;
  /** Rendered as-is; the value has already been through `project()`. */
  format?: 'text' | 'money_minor' | 'date' | 'state';
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry is heterogeneous by design
type AnyDefinition = ResourceDefinition<any>;

export type RegisteredResource = {
  def: AnyDefinition;
  /** URL segment: /r/<path>. */
  path: string;
  nav: string;
  /** Grouping label in the sidebar, e.g. 'Refunds'; several resources can share one app. */
  app: string;
  columns: Column[];
  orderBy?: Record<string, 'asc' | 'desc'>;
  /** Column shown as the row's title on the detail screen. */
  titleField?: string;
  /**
   * The declared escape hatch: an app-specific panel on the detail screen, for the things
   * generation cannot invent (refunds' request form). Everything around it stays generated,
   * and the panel still goes through the operation gateway.
   */
  detailPanel?: ComponentType<{
    recordId: string;
    data: Record<string, unknown>;
    /** Server-computed availability, so a panel never decides for itself who may act. */
    actions: AvailableAction[];
  }>;
  /**
   * Actions whose payload the panel collects (a KYC decision needs a reason). The generated
   * action card omits them rather than offering a second, payload-less button that the
   * app's own guard would then reject.
   */
  panelActions?: string[];
};

const registry = new Map<string, RegisteredResource>();

export function registerResource(entry: RegisteredResource): RegisteredResource {
  const existing = registry.get(entry.def.name);
  if (existing && existing.path !== entry.path) {
    throw new Error(`resource '${entry.def.name}' is already registered at '${existing.path}'`);
  }
  for (const other of registry.values()) {
    if (other.path === entry.path && other.def.name !== entry.def.name) {
      throw new Error(`path '${entry.path}' is already used by resource '${other.def.name}'`);
    }
  }
  registry.set(entry.def.name, entry);
  return entry;
}

export function resetRegistry(): void {
  registry.clear();
}

export function registeredResources(): RegisteredResource[] {
  return [...registry.values()];
}

export function resourceByPath(path: string): RegisteredResource | undefined {
  return registeredResources().find((entry) => entry.path === path);
}

export function resourceByName(name: string): RegisteredResource | undefined {
  return registry.get(name);
}
