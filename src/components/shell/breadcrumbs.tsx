'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Derived from the URL rather than passed down by every page: the routes are generated from
 * the registry, so the trail should be too. `labels` carries the registry's names for the
 * segments a URL cannot spell, such as a resource path.
 */
export function Breadcrumbs({ labels }: { labels: Record<string, string> }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  const crumbs = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join('/')}`;
    // A record id is an identifier, not a phrase: shorten it, but never prettify it into
    // something that cannot be pasted back into a URL.
    const raw = index === 2 && segments[0] === 'r' ? segment : segment.replace(/-/g, ' ');
    const fallback = raw.length > 18 ? `${raw.slice(0, 16)}…` : raw;
    return { href, label: labels[href] ?? fallback };
  });

  // '/r' is a routing artefact, not a place: /r/refunds/abc reads 'Refunds / abc'.
  const visible = crumbs.filter((crumb) => crumb.href !== '/r');

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <Link href="/" className="text-neutral-500 hover:text-neutral-900">
        Overview
      </Link>
      {visible.map((crumb, index) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          <span className="text-neutral-300">/</span>
          {index === visible.length - 1 ? (
            <span className="text-neutral-900">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="text-neutral-500 hover:text-neutral-900">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
