-- Resolve SalaryStructure migration drift.
ALTER TABLE "SalaryStructure" ADD COLUMN "pfBase" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Extend the existing attendance enum used by legacy records and canonical records.
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'LATE';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'ON_LEAVE';

-- Add a typed status enum for canonical regularization requests.
CREATE TYPE "RegularizationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "attendance_records"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "AttendanceStatus" USING "status"::"AttendanceStatus",
  ALTER COLUMN "status" SET DEFAULT 'PRESENT'::"AttendanceStatus";

ALTER TABLE "attendance_regularizations"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "RegularizationStatus" USING "status"::"RegularizationStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING'::"RegularizationStatus";

-- Replace restrictive generated foreign keys with cascade behavior.
ALTER TABLE "attendance_records" DROP CONSTRAINT IF EXISTS "attendance_records_userId_fkey";
ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance_regularizations" DROP CONSTRAINT IF EXISTS "attendance_regularizations_userId_fkey";
ALTER TABLE "attendance_regularizations"
  ADD CONSTRAINT "attendance_regularizations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
