-- Prevent multiple global holidays on the same business date.
CREATE UNIQUE INDEX "Holiday_global_date_key"
ON "Holiday"("date")
WHERE "location" IS NULL;
