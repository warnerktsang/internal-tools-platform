/**
 * shadcn/ui-style primitives, copied in rather than depended on. Deliberately the smallest
 * set the three apps need — the load-bearing components are the substrate ones next door.
 */
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-lg border border-neutral-200 bg-white shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('border-b border-neutral-100 px-4 py-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-sm font-semibold text-neutral-900', className)} {...props} />;
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-4 py-3', className)} {...props} />;
}

const BUTTON_VARIANTS = {
  default: 'bg-accent-600 text-white hover:bg-accent-700',
  outline: 'border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50',
  ghost: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
  danger: 'bg-red-700 text-white hover:bg-red-600',
} as const;

export function Button({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

const BADGE_TONES = {
  neutral: 'bg-neutral-100 text-neutral-700',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-blue-100 text-blue-800',
  slate: 'bg-slate-200 text-slate-800',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100',
        className,
      )}
      {...props}
    />
  );
}

const DOT_TONES = {
  neutral: 'bg-neutral-400',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  slate: 'bg-slate-400',
} as const;

/** WorkOS-style status: a coloured dot beside plain text, rather than a filled pill. */
export function StatusDot({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-neutral-700">
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT_TONES[tone])} />
      {children}
    </span>
  );
}

/** The monospace identifier chip WorkOS puts next to an entity's name. */
export function IdChip({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-xs text-neutral-600',
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'border-b border-neutral-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('border-b border-neutral-100 px-4 py-2 text-neutral-800', className)} {...props} />;
}
