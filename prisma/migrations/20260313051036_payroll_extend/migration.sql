/*
  Warnings:

  - You are about to drop the column `allowances` on the `Payroll` table. All the data in the column will be lost.
  - You are about to drop the column `healthInsurance` on the `Payroll` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Payroll" DROP COLUMN "allowances",
DROP COLUMN "healthInsurance",
ADD COLUMN     "leaveDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "otherAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "specialAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0;
