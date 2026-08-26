/**
 * The policy engine. One implementation, used by every app, for reads as well as writes.
 *
 * Evaluation order, and the order is the design:
 *   1. permission  - does any of the principal's roles grant `resource:action`?
 *   2. scope       - if the granting role is scoped, is the record inside the principal's
 *                    grants for this resource's scope dimension?
 *   3. deny rules  - evaluated last; a deny overrides every grant above it.
 */
import { DENY_RULES, ROLES } from '@/config/roles';
import {
  GLOBAL_SCOPE,
  type AuthorizeDecision,
  type DenyRule,
  type Permission,
  type Principal,
  type Role,
  type ScopeDimension,
  type ScopedRecord,
} from '@/substrate/types';

export type AuthorizeInput = {
  principal: Principal;
  resource: string;
  action: string;
  /** Which axis this resource is scoped along. Omit for unscoped resources. */
  scopeDimension?: ScopeDimension;
  /** Omit for collection-level checks; scope is then enforced by `scopeFilter`. */
  record?: ScopedRecord;
};

export type PolicyCatalog = { roles: Role[]; denyRules: DenyRule[] };

const DEFAULT_CATALOG: PolicyCatalog = { roles: ROLES, denyRules: DENY_RULES };

export function permission(resource: string, action: string): Permission {
  return `${resource}:${action}`;
}

function rolesOf(principal: Principal, catalog: PolicyCatalog): Role[] {
  return principal.roles
    .map((name) => catalog.roles.find((role) => role.name === name))
    .filter((role): role is Role => role !== undefined);
}

/** Every permission the principal holds. Used by the UI to decide what to even render. */
export function permissionsFor(
  principal: Principal,
  catalog: PolicyCatalog = DEFAULT_CATALOG,
): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of rolesOf(principal, catalog)) {
    for (const granted of role.permissions) out.add(granted);
  }
  return out;
}

export function hasPermission(
  principal: Principal,
  perm: Permission,
  catalog: PolicyCatalog = DEFAULT_CATALOG,
): boolean {
  return permissionsFor(principal, catalog).has(perm);
}

export type ScopeAccess =
  | { mode: 'global' }
  | { mode: 'scoped'; values: string[] }
  | { mode: 'none' };

/**
 * What the principal may see along one dimension. `global` injects no predicate;
 * `scoped` injects `IN (values)`; `none` means the principal holds no grant at all,
 * which must produce an empty result rather than an unfiltered one.
 */
export function scopeAccess(
  principal: Principal,
  dimension: ScopeDimension,
  resource: string,
  action = 'read',
  catalog: PolicyCatalog = DEFAULT_CATALOG,
): ScopeAccess {
  const granting = rolesOf(principal, catalog).filter((role) =>
    role.permissions.includes(permission(resource, action)),
  );
  if (granting.length === 0) return { mode: 'none' };
  if (granting.some((role) => role.grant === 'global')) return { mode: 'global' };

  const values = principal.scopes[dimension] ?? [];
  if (values.includes(GLOBAL_SCOPE)) return { mode: 'global' };
  if (values.length === 0) return { mode: 'none' };
  return { mode: 'scoped', values };
}

/**
 * Scope enforced in the query, not after the fetch. Filtering a page of results in
 * application code is the bug that leaks row counts, breaks pagination and silently
 * truncates exports.
 */
export function scopeFilter(
  principal: Principal,
  dimension: ScopeDimension,
  resource: string,
  action = 'read',
  catalog: PolicyCatalog = DEFAULT_CATALOG,
): { in: string[] } | undefined {
  const access = scopeAccess(principal, dimension, resource, action, catalog);
  if (access.mode === 'global') return undefined;
  if (access.mode === 'none') return { in: [] };
  return { in: access.values };
}

export function authorize(
  input: AuthorizeInput,
  catalog: PolicyCatalog = DEFAULT_CATALOG,
): AuthorizeDecision {
  const { principal, resource, action, scopeDimension, record } = input;
  const required = permission(resource, action);

  const granting = rolesOf(principal, catalog).filter((role) =>
    role.permissions.includes(required),
  );
  if (granting.length === 0) {
    return { allowed: false, reason: `no role held by ${principal.displayName} grants ${required}` };
  }

  if (record && scopeDimension && !granting.some((role) => role.grant === 'global')) {
    const grants = principal.scopes[scopeDimension] ?? [];
    const global = grants.includes(GLOBAL_SCOPE);
    if (!global && (record.scopeValue === null || !grants.includes(record.scopeValue))) {
      return {
        allowed: false,
        reason: `${record.resource} ${record.id} is outside your ${scopeDimension} scope (${record.scopeValue ?? 'unset'})`,
        rule: 'scope',
      };
    }
  }

  for (const rule of catalog.denyRules) {
    if (rule.when({ principal, resource, action, record })) {
      return { allowed: false, reason: rule.reason, rule: rule.name };
    }
  }

  return { allowed: true };
}
