-- Persist security lock state on users.
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- Persist policy-derived loss-of-pay leave decisions.
ALTER TABLE "Leave" ADD COLUMN "isLossOfPay" BOOLEAN NOT NULL DEFAULT false;
