/*
  Warnings:

  - You are about to drop the column `publishState` on the `flag_configs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."flag_configs" DROP COLUMN "publishState",
ADD COLUMN     "publishError" TEXT,
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'live';
