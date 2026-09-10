-- CreateEnum
CREATE TYPE "PerformanceGoalCategory" AS ENUM ('INDIVIDUAL', 'TEAM', 'COMPANY');

-- CreateEnum
CREATE TYPE "PerformanceGoalStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AppraisalReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'COMPLETED');

-- CreateTable
CREATE TABLE "PerformanceGoal" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "PerformanceGoalCategory" NOT NULL DEFAULT 'INDIVIDUAL',
    "status" "PerformanceGoalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalReview" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "reviewerId" INTEGER NOT NULL,
    "cycleName" TEXT NOT NULL,
    "status" "AppraisalReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "rating" DOUBLE PRECISION,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppraisalReview_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PerformanceGoal" ADD CONSTRAINT "PerformanceGoal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalReview" ADD CONSTRAINT "AppraisalReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;