'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Sidebar row: a filled pill when the current path is inside it. */
export function NavLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-neutral-100 font-medium text-neutral-900'
          : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900',
        className,
      )}
    >
      {children}
    </Link>
  );
}
