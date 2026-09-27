-- Preserve the intended Asia/Kolkata business calendar date for existing holiday rows
-- before the column is changed from timestamp to PostgreSQL DATE.
UPDATE "Holiday"
SET "date" = (("date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date;

ALTER TABLE "Holiday"
ALTER COLUMN "date" TYPE DATE
USING ("date"::date);
