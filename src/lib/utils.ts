import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatMoneyMinor(value: unknown): string {
  const minor = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(minor)) return '—';
  return (minor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace('T', ' ').slice(0, 16);
}
