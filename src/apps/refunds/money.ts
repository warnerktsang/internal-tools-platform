/**
 * Money is integer minor units everywhere inside the system. Parsing happens once, at the
 * edge, and rejects anything it cannot represent exactly — `parseFloat('19.99') * 100` is
 * 1998.9999999999998, and a rounding rule applied in three places is three rules.
 */
export type ParsedAmount = { ok: true; minor: number } | { ok: false; reason: string };

export function parseAmountToMinor(input: string): ParsedAmount {
  const trimmed = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, reason: 'enter an amount like 19.99 (at most two decimal places)' };
  }

  const [whole, fraction = ''] = trimmed.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (minor <= 0) return { ok: false, reason: 'amount must be greater than zero' };
  if (!Number.isSafeInteger(minor)) return { ok: false, reason: 'amount is too large' };

  return { ok: true, minor };
}
