'use client';

import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export type RowMenuItem = { label: string; href: string };

/**
 * The trailing `...` menu on a table row. Navigation only: everything that changes state
 * lives on the record's own screen, where the server has already decided whether this
 * principal may do it — a menu that offered actions here would be guessing.
 */
export function RowMenu({ items, copyValue }: { items: RowMenuItem[]; copyValue?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative inline-block text-left"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label="Row actions"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900',
          open && 'bg-neutral-100 text-neutral-900',
        )}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>

      {open ? (
        <div className="absolute right-0 z-10 mt-1 w-52 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
          {items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="block rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-accent-50 hover:text-accent-700"
            >
              {item.label}
            </Link>
          ))}
          {copyValue ? (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(copyValue);
                setOpen(false);
              }}
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-accent-50 hover:text-accent-700"
            >
              Copy record ID
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
