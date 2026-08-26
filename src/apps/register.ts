/**
 * Where the apps plug in. Importing this module registers every resource, which is all the
 * shell needs to produce navigation and screens for them.
 */
import { registerKyc } from '@/apps/kyc/register';
import { registerRefunds } from '@/apps/refunds/register';

registerKyc();
registerRefunds();

export {};
