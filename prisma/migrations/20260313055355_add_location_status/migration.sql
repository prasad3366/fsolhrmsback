-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('OFFICE', 'OUTSIDE', 'WFH');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "locationStatus" "LocationStatus";
