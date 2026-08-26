/**
 * Record creation, through the same gate as every other write.
 *
 * `execute()` cannot express this: there is no row to lock and no current state to check.
 * Everything else is identical — the declared permission is checked against the *candidate*
 * record's scope value (otherwise a support agent could file a refund into another business
 * unit), the app's guard runs inside the transaction, and the insert commits with its audit
 * row or not at all.
 */
import { Prisma } from '@prisma/client';
import { newRequestId, recordDenial, writeAudit } from '@/substrate/audit';
import { authorize, type PolicyCatalog } from '@/substrate/authz';
import { db } from '@/substrate/db';
import { projectForAudit } from '@/substrate/fields';
import { scopeValueOf, type ResourceDefinition } from '@/substrate/resource';
import { InvalidOperation, type OperationResult, type Principal, type Tx } from '@/substrate/types';

export type CreateInput<TRecord extends Record<string, unknown>> = {
  resource: ResourceDefinition<TRecord>;
  principal: Principal;
  data: Record<string, unknown>;
  requestId?: string;
  idempotencyKey?: string;
  catalog?: PolicyCatalog;
  client?: typeof db;
};

export type CreateOutput = OperationResult<{ id: string; state: string }>;

/** For guards that must serialize against a related aggregate (a payment's refund total). */
export async function lockRow(tx: Tx, table: string, id: string): Promise<void> {
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
}

export async function create<TRecord extends Record<string, unknown>>(
  input: CreateInput<TRecord>,
): Promise<CreateOutput> {
  const { resource: def, principal, data, idempotencyKey, catalog, client = db } = input;
  const requestId = input.requestId ?? newRequestId();

  if (!def.creation) {
    return { status: 'invalid', reason: `${def.name} cannot be created through the platform` };
  }

  if (idempotencyKey) {
    const replay = await client.idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
    if (replay) return replay.outcome as CreateOutput;
  }

  const [, action] = def.creation.permission.split(':');
  const decision = authorize(
    {
      principal,
      resource: def.name,
      action: action ?? 'create',
      scopeDimension: def.scope?.dimension,
      // Scope is checked against what is about to exist, not against an existing row.
      record: {
        id: 'new',
        resource: def.name,
        scopeValue: scopeValueOf(def, data),
        state: null,
      },
    },
    catalog,
  );
  if (!decision.allowed) {
    await recordDenial(
      {
        principal,
        resource: def.name,
        action: action ?? 'create',
        reason: decision.reason,
        rule: decision.rule,
        requestId,
      },
      client,
    );
    return { status: 'denied', reason: decision.reason, rule: decision.rule };
  }

  let outcome: CreateOutput;
  try {
    outcome = await client.$transaction(async (tx) => {
      if (def.creation?.guard) await def.creation.guard({ data, principal, tx });
      const derived = def.creation?.derive
        ? await def.creation.derive({ data, principal, tx })
        : {};

      const created = await def
        .delegate(tx)
        .create({ data: { ...data, ...derived, state: def.machine.initial } });

      await writeAudit(tx, {
        kind: 'write',
        principal,
        resource: def.name,
        recordId: String(created.id),
        action: 'create',
        after: projectForAudit(created, def.fields, def.name),
        requestId,
        idempotencyKey: idempotencyKey ?? null,
      });

      return {
        status: 'ok',
        data: { id: String(created.id), state: def.machine.initial },
      } satisfies CreateOutput;
    });
  } catch (error) {
    if (error instanceof InvalidOperation) {
      return { status: 'invalid', reason: error.message, field: error.field };
    }
    throw error;
  }

  if (idempotencyKey && outcome.status === 'ok') {
    await client.idempotencyRecord.create({
      data: {
        key: idempotencyKey,
        resource: def.name,
        recordId: outcome.data.id,
        action: 'create',
        outcome: outcome as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return outcome;
}
