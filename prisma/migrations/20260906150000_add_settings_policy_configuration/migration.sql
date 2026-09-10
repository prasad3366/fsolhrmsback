-- Extend the existing holiday table for unified settings holiday management.
ALTER TABLE "Holiday" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Holiday" ADD COLUMN "branchId" INTEGER;

-- CreateTable
CREATE TABLE "attendance_policies" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "workDays" TEXT NOT NULL DEFAULT 'MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY',
    "shiftStartTime" TEXT NOT NULL DEFAULT '09:00',
    "shiftEndTime" TEXT NOT NULL DEFAULT '18:00',
    "gracePeriodMins" INTEGER NOT NULL DEFAULT 15,
    "lateArrivalThreshold" INTEGER NOT NULL DEFAULT 30,
    "earlyCheckoutMins" INTEGER NOT NULL DEFAULT 30,
    "halfDayHours" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    "autoCheckoutEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoCheckoutTime" TEXT NOT NULL DEFAULT '22:00',
    "overtimeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leave_policies" (
    "id" SERIAL NOT NULL,
    "leaveTypeName" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "annualAllocation" INTEGER NOT NULL DEFAULT 12,
    "accrualFrequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "carryForwardMax" INTEGER NOT NULL DEFAULT 0,
    "allowHalfDay" BOOLEAN NOT NULL DEFAULT true,
    "requiresDocument" BOOLEAN NOT NULL DEFAULT false,
    "isLossOfPay" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "empIdPrefix" TEXT NOT NULL DEFAULT 'FDZ-',
    "empIdNextNumber" INTEGER NOT NULL DEFAULT 1001,
    "probationDays" INTEGER NOT NULL DEFAULT 90,
    "noticePeriodDays" INTEGER NOT NULL DEFAULT 30,
    "requireOnboarding" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "employee_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_policies" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "minPasswordLength" INTEGER NOT NULL DEFAULT 8,
    "requireUppercase" BOOLEAN NOT NULL DEFAULT true,
    "requireNumbers" BOOLEAN NOT NULL DEFAULT true,
    "requireSymbols" BOOLEAN NOT NULL DEFAULT true,
    "maxFailedLogins" INTEGER NOT NULL DEFAULT 5,
    "accountLockMins" INTEGER NOT NULL DEFAULT 30,
    "sessionTimeoutMins" INTEGER NOT NULL DEFAULT 60,
    "enable2FA" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "security_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_workflows" (
    "id" SERIAL NOT NULL,
    "module" TEXT NOT NULL,
    "approvalLevels" INTEGER NOT NULL DEFAULT 1,
    "requireComment" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "approval_workflows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "notifyLeaveRequest" BOOLEAN NOT NULL DEFAULT true,
    "notifyLeaveApproval" BOOLEAN NOT NULL DEFAULT true,
    "notifyLateAttendance" BOOLEAN NOT NULL DEFAULT false,
    "notifyAnniversaries" BOOLEAN NOT NULL DEFAULT true,
    "notifyNewJoiner" BOOLEAN NOT NULL DEFAULT true,
    "emailChannelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inAppChannelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leave_policies_leaveTypeName_key" ON "leave_policies"("leaveTypeName");
CREATE UNIQUE INDEX "leave_policies_code_key" ON "leave_policies"("code");
CREATE UNIQUE INDEX "approval_workflows_module_key" ON "approval_workflows"("module");
