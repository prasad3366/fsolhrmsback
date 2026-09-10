-- AlterEnum
ALTER TYPE "AnnouncementAudience" ADD VALUE 'TEAM';

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "teamId" INTEGER;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
