ALTER TABLE "Leave"
  ADD COLUMN "decisionByEmployeeId" INTEGER,
  ADD COLUMN "decisionByRole" TEXT,
  ADD COLUMN "decisionAt" TIMESTAMP(3),
  ADD COLUMN "decisionReason" TEXT;

ALTER TABLE "Leave"
  ADD CONSTRAINT "Leave_decisionByEmployeeId_fkey"
  FOREIGN KEY ("decisionByEmployeeId") REFERENCES "Employee"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
