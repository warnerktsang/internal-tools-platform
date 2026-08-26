import type { Tx } from '@/substrate/types';

/**
 * Loading fixtures is not an operation performed by a principal. The seeder disables the
 * require-audit trigger for its own transaction rather than writing fictional actors into
 * the trail. Nothing outside the seeder and the test helpers may call this.
 */
export async function enableAuditBypass(tx: Tx): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL app.audit_bypass = 'on'`);
}
