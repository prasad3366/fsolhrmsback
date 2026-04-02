/*
  Warnings:

  - You are about to drop the column `pfBase` on the `SalaryStructure` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SalaryStructure" DROP COLUMN "pfBase",
ALTER COLUMN "basicPercent" SET DEFAULT 35,
ALTER COLUMN "hraPercent" SET DEFAULT 50,
ALTER COLUMN "conveyancePercent" SET DEFAULT 15;
