import {
  Boxes,
  CreditCard,
  FileClock,
  Flag,
  LayoutGrid,
  ScrollText,
  ShieldCheck,
  Table2,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { PrincipalSwitcher } from '@/components/principal-switcher';
import { NavLink } from '@/components/shell/nav-link';
import type { RegisteredResource } from '@/substrate/registry';
import type { Principal } from '@/substrate/types';

const APP_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  KYC: ShieldCheck,
  Refunds: CreditCard,
  'Feature flags': Flag,
};

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
      {children}
    </p>
  );
}

/**
 * Two halves, deliberately: the apps, and the substrate they are declared against. The
 * second half is the argument — a console that can show you the roles, the resource model
 * and the trail is a platform, not three screens that happen to share a stylesheet.
 */
export function Sidebar({
  resources,
  principal,
  principals,
}: {
  resources: RegisteredResource[];
  principal: Principal | null;
  principals: Principal[];
}) {
  const apps = new Map<string, RegisteredResource[]>();
  for (const entry of resources) {
    apps.set(entry.app, [...(apps.get(entry.app) ?? []), entry]);
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 border-r border-neutral-200 bg-white px-3 py-4">
      <div className="flex items-center gap-2 px-1 pb-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-900 text-white">
          <Boxes className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="text-sm font-semibold text-neutral-900">Internal Tools</span>
      </div>

      <PrincipalSwitcher principals={principals} current={principal} returnTo="/" />

      <nav className="mt-3 flex flex-col">
        <NavLink href="/">
          <LayoutGrid className="h-4 w-4 text-neutral-400" aria-hidden />
          Overview
        </NavLink>

        {[...apps].map(([app, entries]) => {
          const Icon = APP_ICONS[app] ?? Table2;
          return (
            <div key={app}>
              <SectionLabel>{app}</SectionLabel>
              {entries.map((entry) => (
                <NavLink key={entry.path} href={`/r/${entry.path}`}>
                  <Icon className="h-4 w-4 text-neutral-400" />
                  {entry.nav}
                </NavLink>
              ))}
            </div>
          );
        })}

        <SectionLabel>Platform</SectionLabel>
        <NavLink href="/platform/roles">
          <Users className="h-4 w-4 text-neutral-400" aria-hidden />
          Roles &amp; permissions
        </NavLink>
        <NavLink href="/platform/resource-types">
          <Boxes className="h-4 w-4 text-neutral-400" aria-hidden />
          Resource types
        </NavLink>
        <NavLink href="/platform/policies">
          <ScrollText className="h-4 w-4 text-neutral-400" aria-hidden />
          Deny rules
        </NavLink>
        <NavLink href="/audit">
          <FileClock className="h-4 w-4 text-neutral-400" aria-hidden />
          Audit logs
        </NavLink>
      </nav>
    </aside>
  );
}
