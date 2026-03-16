-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'INTERN');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('MARRIED', 'UNMARRIED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "aadharNumber" TEXT,
ADD COLUMN     "addedBy" TEXT,
ADD COLUMN     "age" INTEGER,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "currentAddress" TEXT,
ADD COLUMN     "currentExperience" DOUBLE PRECISION,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "dateOfExit" TIMESTAMP(3),
ADD COLUMN     "dateOfJoining" TIMESTAMP(3),
ADD COLUMN     "employmentType" "EmploymentType",
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "ifscCode" TEXT,
ADD COLUMN     "maritalStatus" "MaritalStatus",
ADD COLUMN     "panNumber" TEXT,
ADD COLUMN     "permanentAddress" TEXT,
ADD COLUMN     "personalMobile" TEXT,
ADD COLUMN     "pfNumber" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "reportingManager" TEXT,
ADD COLUMN     "sourceOfHire" TEXT,
ADD COLUMN     "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "uanNumber" TEXT;
