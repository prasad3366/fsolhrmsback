-- Add canonical paid-vs-LOP values without changing existing payroll rows.
ALTER TABLE "Leave"
  ADD COLUMN "paidLeaveDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "lopDays" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Only approved historical leave represents a consumed paid/LOP allocation.
UPDATE "Leave"
SET
  "paidLeaveDays" = CASE
    WHEN "status" = 'APPROVED' AND NOT "isLossOfPay" THEN "totalDays"
    ELSE 0
  END,
  "lopDays" = CASE
    WHEN "status" = 'APPROVED' AND "isLossOfPay" THEN "totalDays"
    ELSE 0
  END;
