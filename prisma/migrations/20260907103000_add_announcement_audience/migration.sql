CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'DEPARTMENT');

ALTER TABLE "announcements"
  ADD COLUMN "targetAudience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
  ADD COLUMN "departmentId" TEXT;

ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;