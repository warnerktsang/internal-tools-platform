/** `pnpm db:seed`. The work itself lives in `seedDemoData()`, which the reseed route shares. */
import { seedDemoData } from '@/seed';
import { db } from '@/substrate/db';

seedDemoData()
  .then(async (summary) => {
    console.log(
      `seeded ${summary.people} people, ${summary.payments} payments, ${summary.refunds} refunds, ${summary.kycCases} KYC cases, ${summary.flagConfigs} flag configs`,
    );
    console.log(`${summary.auditEvents} audit events written by real operations`);
    await db.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
