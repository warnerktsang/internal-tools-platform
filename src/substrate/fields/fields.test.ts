import { describe, expect, it } from 'vitest';
import { maskValue, project, projectForAudit } from '@/substrate/fields';
import { principal } from '@/test/factories';
import type { FieldPolicy, ScopedRecord } from '@/substrate/types';

const policy: FieldPolicy = {
  ssn: { sensitivity: 'restricted', mask: 'last4', revealPermission: 'kyc_case:reveal_pii' },
  dob: { sensitivity: 'restricted', mask: 'date_year', revealPermission: 'kyc_case:reveal_pii' },
  address: { sensitivity: 'restricted', mask: 'redact', revealPermission: 'kyc_case:reveal_pii' },
  internalNotes: { sensitivity: 'sensitive', mask: 'omit', revealPermission: 'kyc_case:reveal_pii' },
  customerName: { sensitivity: 'public', mask: 'redact', revealPermission: 'kyc_case:read' },
};

const record = {
  id: 'case-1',
  customerName: 'Alicia Nunez',
  ssn: '123-45-6789',
  dob: new Date('1987-04-12T00:00:00Z'),
  address: '48 Alameda St, Austin TX',
  internalNotes: 'flagged by vendor screening',
  riskScore: 72,
};

const usCase: ScopedRecord = { id: 'case-1', resource: 'kyc_case', scopeValue: 'us' };

const analyst = principal({ id: 'dana', roles: ['kyc_analyst'], scopes: { business_unit: ['us'] } });
const euAnalyst = principal({ id: 'raj', roles: ['kyc_analyst'], scopes: { business_unit: ['eu'] } });
const auditor = principal({ id: 'ava', roles: ['auditor'], scopes: { business_unit: ['*'] } });

function projectAs(p: Parameters<typeof project>[0]['principal'], reveal: string[] = []) {
  return project({
    record,
    policy,
    resource: 'kyc_case',
    principal: p,
    reveal,
    scopeDimension: 'business_unit',
    scopedRecord: usCase,
  });
}

describe('mask strategies', () => {
  it('masks without ever emitting the underlying value', () => {
    expect(maskValue('123-45-6789', 'last4')).toBe('••••6789');
    expect(maskValue('secret', 'redact')).toBe('••••');
    expect(maskValue('48 Alameda St', 'partial')).toBe('48••••St');
    expect(maskValue(new Date('1987-04-12T00:00:00Z'), 'date_year')).toBe('1987');
    expect(maskValue('anything', 'omit')).toBeUndefined();
  });

  it('does not leak short values through last4 or partial', () => {
    expect(maskValue('1234', 'last4')).toBe('••••');
    expect(maskValue('ab', 'partial')).toBe('••••');
  });

  it('preserves null and undefined rather than inventing a mask', () => {
    expect(maskValue(null, 'last4')).toBeNull();
    expect(maskValue(undefined, 'redact')).toBeUndefined();
  });

  it('masks an unparseable date rather than emitting NaN', () => {
    expect(maskValue('not-a-date', 'date_year')).toBe('••••');
  });
});

describe('project()', () => {
  it('masks restricted fields by default and reports what could be revealed', () => {
    const projected = projectAs(analyst);
    expect(projected.data.ssn).toBe('••••6789');
    expect(projected.data.dob).toBe('1987');
    expect(projected.data.address).toBe('••••');
    expect(projected.data).not.toHaveProperty('internalNotes');
    expect(projected.data.customerName).toBe('Alicia Nunez');
    expect(projected.data.riskScore).toBe(72);
    expect(projected.masked.sort()).toEqual(['address', 'dob', 'internalNotes', 'ssn']);
    expect(projected.revealed).toEqual([]);
    expect(projected.revealable.sort()).toEqual(['address', 'dob', 'internalNotes', 'ssn']);
  });

  it('reveals only the requested fields, and only with permission', () => {
    const projected = projectAs(analyst, ['ssn']);
    expect(projected.data.ssn).toBe('123-45-6789');
    expect(projected.revealed).toEqual(['ssn']);
    expect(projected.data.address).toBe('••••');
    expect(projected.masked).toContain('address');
  });

  it('ignores a reveal request the principal is not authorized for', () => {
    const projected = project({
      record,
      policy,
      resource: 'kyc_case',
      principal: euAnalyst,
      reveal: ['ssn'],
      scopeDimension: 'business_unit',
      scopedRecord: usCase,
    });
    expect(projected.data.ssn).toBe('••••6789');
    expect(projected.revealed).toEqual([]);
    expect(projected.revealable).toEqual([]);
  });

  it('honours deny rules when deciding revealability', () => {
    const projected = projectAs(auditor, ['ssn']);
    expect(projected.data.ssn).toBe('••••6789');
    expect(projected.revealable).toEqual([]);
  });

  it('masks everything when there is no principal, so audit payloads carry no raw PII', () => {
    const audited = projectForAudit(record, policy, 'kyc_case');
    expect(audited.ssn).toBe('••••6789');
    expect(audited.address).toBe('••••');
    expect(audited).not.toHaveProperty('internalNotes');
    expect(audited.customerName).toBe('Alicia Nunez');
  });

  it('passes through fields the policy says nothing about', () => {
    const projected = projectAs(analyst);
    expect(projected.data.id).toBe('case-1');
  });
});
