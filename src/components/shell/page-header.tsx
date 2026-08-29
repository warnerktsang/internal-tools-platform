import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

function initials(title: string): string {
  const words = title.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  if (words.length === 0) return '??';
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

/**
 * The entity header: an identity tile, the name, and the facts about this record that hold
 * true on every tab (its state, its scope, its id). Actions sit on the right, where a
 * console puts them.
 */
export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
  tile = true,
}: {
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  tile?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {tile ? (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-sm font-semibold text-neutral-600">
            {initials(title)}
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-neutral-900">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-sm text-neutral-500">{subtitle}</div> : null}
          {meta ? <div className="mt-1.5 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type Tab = { key: string; label: string; count?: number };

/** Underlined tabs beneath the entity header; the selected tab is a URL, not client state. */
export function Tabs({ tabs, current, basePath }: { tabs: Tab[]; current: string; basePath: string }) {
  return (
    <div className="-mt-2 border-b border-neutral-200">
      <nav className="flex gap-4">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <Link
              key={tab.key}
              href={tab.key === tabs[0].key ? basePath : `${basePath}?tab=${tab.key}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2.5 text-sm transition-colors',
                active
                  ? 'border-accent-600 font-medium text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-900',
              )}
            >
              {tab.label}
              {tab.count !== undefined ? (
                <span className="rounded-full bg-neutral-100 px-1.5 text-xs text-neutral-600">
                  {tab.count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
