-- Expand the existing singleton settings row without recreating the table.
ALTER TABLE "system_settings" RENAME COLUMN "timezone" TO "timeZone";
ALTER TABLE "system_settings" DROP COLUMN "workDaysPerWeek";
ALTER TABLE "system_settings" DROP COLUMN "gracePeriodMins";
ALTER TABLE "system_settings" ADD COLUMN "companyLogo" TEXT;
ALTER TABLE "system_settings" ADD COLUMN "companyPhone" TEXT;
ALTER TABLE "system_settings" ADD COLUMN "financialYearStart" TEXT NOT NULL DEFAULT 'April';
ALTER TABLE "system_settings" ADD COLUMN "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY';
ALTER TABLE "system_settings" ADD COLUMN "timeFormat" TEXT NOT NULL DEFAULT '12H';

-- Expand the existing permission matrix while preserving current read/write values.
ALTER TABLE "role_permissions" RENAME COLUMN "canRead" TO "canView";
ALTER TABLE "role_permissions" RENAME COLUMN "canWrite" TO "canCreate";
ALTER TABLE "role_permissions" ADD COLUMN "canEdit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "role_permissions" ADD COLUMN "canApprove" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "role_permissions" ADD COLUMN "canExport" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "branches" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "isHeadquarters" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "userEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "ipAddress" TEXT,
    "previousVal" TEXT,
    "newVal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");
