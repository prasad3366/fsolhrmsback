-- Create enums
CREATE TYPE "NotificationEntityType" AS ENUM (
  'LEAVE',
  'WFH',
  'HELPDESK',
  'ATTENDANCE',
  'ATTENDANCE_REGULARIZATION',
  'DOCUMENT',
  'ASSET',
  'PERFORMANCE',
  'PAYROLL',
  'SALARY',
  'RECRUITMENT',
  'TRAINING',
  'ANNOUNCEMENT',
  'EMPLOYEE',
  'HOLIDAY',
  'OTHER'
);

CREATE TYPE "ActionType" AS ENUM (
  'REVIEW',
  'APPROVE',
  'REJECT',
  'RESPOND',
  'ACKNOWLEDGE',
  'COMPLETE',
  'UPDATE',
  'OTHER'
);

CREATE TYPE "ActionItemStatus" AS ENUM (
  'PENDING',
  'RESOLVED'
);

-- Create notification table
CREATE TABLE "notifications" (
    "id" SERIAL PRIMARY KEY,
    "recipientUserId" INTEGER NOT NULL,
    "entityType" "NotificationEntityType" NOT NULL,
    "entityId" INTEGER NOT NULL,
    "actorUserId" INTEGER,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_recipientUserId_fkey"
      FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "notifications_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL
);

-- Create action item table
CREATE TABLE "action_items" (
    "id" SERIAL PRIMARY KEY,
    "recipientUserId" INTEGER NOT NULL,
    "entityType" "NotificationEntityType" NOT NULL,
    "entityId" INTEGER NOT NULL,
    "actionType" "ActionType" NOT NULL,
    "status" "ActionItemStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_items_recipientUserId_fkey"
      FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- Indexes
CREATE INDEX "notifications_recipientUserId_idx"
    ON "notifications" ("recipientUserId");

CREATE INDEX "notifications_recipientUserId_readAt_idx"
    ON "notifications" ("recipientUserId", "readAt");

CREATE INDEX "action_items_recipientUserId_status_idx"
    ON "action_items" ("recipientUserId", "status");

CREATE INDEX "notifications_entityType_entityId_idx"
    ON "notifications" ("entityType", "entityId");

CREATE INDEX "action_items_entityType_entityId_idx"
    ON "action_items" ("entityType", "entityId");

CREATE UNIQUE INDEX "action_items_unique_active_idx"
    ON "action_items" ("recipientUserId", "entityType", "entityId", "actionType")
    WHERE "status" = 'PENDING';
