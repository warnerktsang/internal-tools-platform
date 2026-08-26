/**
 * `pnpm audit:verify` — walks the hash chain and reports the first break.
 * Demonstrable tamper-evidence, rather than asserted tamper-evidence.
 */
import { verifyAuditChain } from '@/substrate/audit';
import { db } from '@/substrate/db';

async function main() {
  const result = await verifyAuditChain();
  if (result.ok) {
    console.log(`audit chain intact: ${result.checked} event(s) verified`);
    return;
  }
  console.error(
    `audit chain BROKEN at seq ${result.brokenAtSeq} (${result.problem}) after ${result.checked} verified event(s)`,
  );
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
