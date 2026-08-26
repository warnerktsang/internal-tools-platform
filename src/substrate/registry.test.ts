import { beforeEach, describe, expect, it } from 'vitest';
import {
  registerResource,
  registeredResources,
  resetRegistry,
  resourceByName,
  resourceByPath,
} from '@/substrate/registry';
import { defineResource } from '@/substrate/resource';

function resource(name: string, table: string) {
  return defineResource<{ id: string; state: string }>({
    name,
    table,
    label: name,
    delegate: (tx) => tx.kycCase,
    fields: {},
    machine: {
      initial: 'new',
      states: ['new', 'closed'],
      transitions: [{ action: 'close', from: ['new'], to: 'closed', permission: `${name}:close` }],
    },
  });
}

describe('resource registry', () => {
  beforeEach(() => resetRegistry());

  it('derives navigation from what registered, in registration order', () => {
    registerResource({
      def: resource('kyc_case', 'kyc_cases'),
      path: 'kyc-cases',
      nav: 'Review queue',
      app: 'KYC',
      columns: [{ field: 'reference', label: 'Case' }],
    });
    registerResource({
      def: resource('refund', 'refunds'),
      path: 'refunds',
      nav: 'Refunds',
      app: 'Refunds',
      columns: [{ field: 'reference', label: 'Refund' }],
    });

    expect(registeredResources().map((entry) => entry.nav)).toEqual(['Review queue', 'Refunds']);
    expect(resourceByPath('refunds')?.def.name).toBe('refund');
    expect(resourceByName('kyc_case')?.path).toBe('kyc-cases');
  });

  it('rejects a second resource claiming an existing path', () => {
    registerResource({
      def: resource('kyc_case', 'kyc_cases'),
      path: 'queue',
      nav: 'Review queue',
      app: 'KYC',
      columns: [],
    });

    expect(() =>
      registerResource({
        def: resource('refund', 'refunds'),
        path: 'queue',
        nav: 'Refunds',
        app: 'Refunds',
        columns: [],
      }),
    ).toThrow(/already used by resource 'kyc_case'/);
  });

  it('rejects registering one resource at two paths, so links cannot fork', () => {
    const def = resource('kyc_case', 'kyc_cases');
    registerResource({ def, path: 'queue', nav: 'Review queue', app: 'KYC', columns: [] });

    expect(() =>
      registerResource({ def, path: 'cases', nav: 'Cases', app: 'KYC', columns: [] }),
    ).toThrow(/already registered at 'queue'/);
  });

  it('is idempotent for the same resource and path, so a re-imported module is harmless', () => {
    const entry = {
      def: resource('kyc_case', 'kyc_cases'),
      path: 'queue',
      nav: 'Review queue',
      app: 'KYC',
      columns: [],
    };
    registerResource(entry);
    registerResource(entry);

    expect(registeredResources()).toHaveLength(1);
  });

  it('rejects an unregistered lookup rather than guessing a resource', () => {
    expect(resourceByPath('nope')).toBeUndefined();
    expect(resourceByName('nope')).toBeUndefined();
  });
});
