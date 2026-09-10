-- Add canonical user and regularization foreign keys.
ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_regularizations"
  ADD CONSTRAINT "attendance_regularizations_attendanceRecordId_fkey"
  FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance_regularizations"
  ADD CONSTRAINT "attendance_regularizations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "attendance_regularizations_status_createdAt_idx"
  ON "attendance_regularizations"("status", "createdAt");
