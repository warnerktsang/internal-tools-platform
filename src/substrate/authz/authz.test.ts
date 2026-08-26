import { describe, expect, it } from 'vitest';
import { authorize, permissionsFor, scopeAccess, scopeFilter } from '@/substrate/authz';
import { principal } from '@/test/factories';
import type { DenyRule, Role, ScopedRecord } from '@/substrate/types';

const analyst = principal({ id: 'dana', roles: ['kyc_analyst'], scopes: { business_unit: ['us'] } });
const euAnalyst = principal({ id: 'raj', roles: ['kyc_analyst'], scopes: { business_unit: ['eu'] } });
const officer = principal({ id: 'omar', roles: ['compliance_officer'], scopes: { business_unit: ['*'] } });
const auditor = principal({ id: 'ava', roles: ['auditor'], scopes: { business_unit: ['*'] } });
const engineer = principal({
  id: 'sam',
  roles: ['engineer'],
  scopes: { environment: ['dev', 'staging'] },
});
const releaseManager = principal({
  id: 'rel',
  roles: ['release_manager'],
  scopes: { environment: ['dev', 'staging', 'production'] },
});

const usCase: ScopedRecord = { id: 'case-1', resource: 'kyc_case', scopeValue: 'us' };
const euCase: ScopedRecord = { id: 'case-2', resource: 'kyc_case', scopeValue: 'eu' };
const prodConfig: ScopedRecord = { id: 'cfg-1', resource: 'flag_config', scopeValue: 'production' };
const devConfig: ScopedRecord = { id: 'cfg-2', resource: 'flag_config', scopeValue: 'dev' };

describe('permission resolution', () => {
  it('resolves the union of permissions across roles', () => {
    const both = principal({ id: 'multi', roles: ['support_agent', 'finance_manager'] });
    const perms = permissionsFor(both);
    expect(perms.has('refund:request')).toBe(true);
    expect(perms.has('refund:approve')).toBe(true);
    expect(perms.has('kyc_case:read')).toBe(false);
  });

  it('denies an action no role grants', () => {
    const decision = authorize({
      principal: analyst,
      resource: 'refund',
      action: 'approve',
    });
    expect(decision).toMatchObject({ allowed: false });
    expect(decision.allowed === false && decision.reason).toContain('refund:approve');
  });

  it('ignores role names that are not in the catalog', () => {
    const ghost = principal({ id: 'ghost', roles: ['not_a_real_role'] });
    expect(permissionsFor(ghost).size).toBe(0);
    expect(authorize({ principal: ghost, resource: 'kyc_case', action: 'read' }).allowed).toBe(false);
  });
});

describe('scope', () => {
  it('allows a scoped role inside its own scope', () => {
    expect(
      authorize({
        principal: analyst,
        resource: 'kyc_case',
        action: 'read',
        scopeDimension: 'business_unit',
        record: usCase,
      }).allowed,
    ).toBe(true);
  });

  it('denies a scoped role outside its own scope', () => {
    const decision = authorize({
      principal: euAnalyst,
      resource: 'kyc_case',
      action: 'read',
      scopeDimension: 'business_unit',
      record: usCase,
    });
    expect(decision).toMatchObject({ allowed: false, rule: 'scope' });
  });

  it('ignores scope grants for a globally granted role', () => {
    expect(
      authorize({
        principal: officer,
        resource: 'kyc_case',
        action: 'read',
        scopeDimension: 'business_unit',
        record: euCase,
      }).allowed,
    ).toBe(true);
  });

  it('treats a record with no scope value as outside every scoped grant', () => {
    const decision = authorize({
      principal: analyst,
      resource: 'kyc_case',
      action: 'read',
      scopeDimension: 'business_unit',
      record: { id: 'case-3', resource: 'kyc_case', scopeValue: null },
    });
    expect(decision.allowed).toBe(false);
  });

  it('injects a predicate for scoped roles and none for global roles', () => {
    expect(scopeFilter(analyst, 'business_unit', 'kyc_case')).toEqual({ in: ['us'] });
    expect(scopeFilter(officer, 'business_unit', 'kyc_case')).toBeUndefined();
    expect(scopeAccess(engineer, 'environment', 'flag_config', 'update')).toEqual({
      mode: 'scoped',
      values: ['dev', 'staging'],
    });
  });

  it('produces an empty predicate rather than an unfiltered query when no grant exists', () => {
    const stranger = principal({ id: 'nobody', roles: [] });
    expect(scopeFilter(stranger, 'business_unit', 'kyc_case')).toEqual({ in: [] });

    const unscoped = principal({ id: 'unscoped', roles: ['kyc_analyst'], scopes: {} });
    expect(scopeFilter(unscoped, 'business_unit', 'kyc_case')).toEqual({ in: [] });
  });

  it('treats a wildcard grant as global', () => {
    const wildcard = principal({
      id: 'wild',
      roles: ['kyc_analyst'],
      scopes: { business_unit: ['*'] },
    });
    expect(scopeFilter(wildcard, 'business_unit', 'kyc_case')).toBeUndefined();
    expect(
      authorize({
        principal: wildcard,
        resource: 'kyc_case',
        action: 'read',
        scopeDimension: 'business_unit',
        record: euCase,
      }).allowed,
    ).toBe(true);
  });
});

describe('deny rules are evaluated last and win', () => {
  it('denies PII reveal to an auditor even when another role grants it', () => {
    const auditorAndAnalyst = principal({
      id: 'ava2',
      roles: ['auditor', 'kyc_analyst'],
      scopes: { business_unit: ['us'] },
    });
    expect(permissionsFor(auditorAndAnalyst).has('kyc_case:reveal_pii')).toBe(true);

    const decision = authorize({
      principal: auditorAndAnalyst,
      resource: 'kyc_case',
      action: 'reveal_pii',
      scopeDimension: 'business_unit',
      record: usCase,
    });
    expect(decision).toMatchObject({ allowed: false, rule: 'auditor_never_reveals_pii' });
  });

  it('leaves reads untouched for an auditor', () => {
    expect(
      authorize({
        principal: auditor,
        resource: 'kyc_case',
        action: 'read',
        scopeDimension: 'business_unit',
        record: euCase,
      }).allowed,
    ).toBe(true);
  });

  it('denies production flag changes to an engineer but allows them in dev', () => {
    const inProd = authorize({
      principal: { ...engineer, scopes: { environment: ['dev', 'staging', 'production'] } },
      resource: 'flag_config',
      action: 'update',
      scopeDimension: 'environment',
      record: prodConfig,
    });
    expect(inProd).toMatchObject({
      allowed: false,
      rule: 'production_flag_change_requires_release_manager',
    });

    expect(
      authorize({
        principal: engineer,
        resource: 'flag_config',
        action: 'update',
        scopeDimension: 'environment',
        record: devConfig,
      }).allowed,
    ).toBe(true);
  });

  it('allows a release manager to change production', () => {
    expect(
      authorize({
        principal: releaseManager,
        resource: 'flag_config',
        action: 'update',
        scopeDimension: 'environment',
        record: prodConfig,
      }).allowed,
    ).toBe(true);
  });
});

describe('catalog injection', () => {
  const roles: Role[] = [
    { name: 'tester', description: 'test', grant: 'global', permissions: ['widget:frob'] },
  ];
  const denyRules: DenyRule[] = [
    { name: 'never_frob', reason: 'frobbing is disabled', when: ({ action }) => action === 'frob' },
  ];

  it('evaluates against an injected catalog, so app policy is data not code', () => {
    const tester = principal({ id: 'tester', roles: ['tester'] });
    expect(authorize({ principal: tester, resource: 'widget', action: 'frob' }, { roles, denyRules: [] }).allowed).toBe(true);
    expect(authorize({ principal: tester, resource: 'widget', action: 'frob' }, { roles, denyRules }).allowed).toBe(false);
  });
});
