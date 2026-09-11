import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const recordId = 8;
const userId = 1;
const originalDate = '2026-09-07';
const targetDate = '2026-09-08';

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function kolkataBusinessDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(value)
    .filter((part) => part.type !== 'literal')
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function main() {
  await prisma.$transaction(async (tx) => {
    const record = await tx.attendanceRecord.findUnique({
      where: { id: recordId },
      select: { id: true, userId: true, date: true, clockIn: true },
    });

    if (!record) {
      throw new Error(`ABORT: AttendanceRecord ${recordId} was not found.`);
    }

    if (record.userId !== userId) {
      throw new Error(
        `ABORT: AttendanceRecord ${recordId} belongs to userId ${record.userId}, expected ${userId}.`,
      );
    }

    const currentDate = dateOnly(record.date);
    if (currentDate !== originalDate) {
      throw new Error(
        `ABORT: AttendanceRecord ${recordId} has date ${currentDate}, expected ${originalDate}.`,
      );
    }

    const conflict = await tx.attendanceRecord.findFirst({
      where: {
        userId,
        date: dateValue(targetDate),
        NOT: { id: recordId },
      },
      select: { id: true, userId: true, date: true },
    });

    if (conflict) {
      throw new Error(
        `ABORT: userId ${userId} already has AttendanceRecord ${conflict.id} dated ${targetDate}.`,
      );
    }

    await tx.attendanceRecord.update({
      where: { id: recordId },
      data: { date: dateValue(targetDate) },
    });

    const updated = await tx.attendanceRecord.findUnique({
      where: { id: recordId },
      select: { id: true, userId: true, date: true, clockIn: true },
    });

    if (!updated || dateOnly(updated.date) !== targetDate) {
      throw new Error(
        `ABORT: AttendanceRecord ${recordId} did not persist date ${targetDate}.`,
      );
    }

    if (kolkataBusinessDate(updated.clockIn) !== targetDate) {
      throw new Error(
        `ABORT: AttendanceRecord ${recordId} clockIn derives to ${kolkataBusinessDate(updated.clockIn)}, expected ${targetDate}.`,
      );
    }

    const duplicateCount = await tx.attendanceRecord.count({
      where: { userId, date: dateValue(targetDate) },
    });

    if (duplicateCount !== 1) {
      throw new Error(
        `ABORT: expected one AttendanceRecord for userId ${userId}/${targetDate}, found ${duplicateCount}.`,
      );
    }

    console.log(`ID ${recordId}: ${currentDate} -> ${dateOnly(updated.date)}`);
    console.log(`Derived Asia/Kolkata business date: ${kolkataBusinessDate(updated.clockIn)}`);
    console.log(`Duplicate (userId,date) count: ${duplicateCount}`);
  });

  console.log('AttendanceRecord ID 8 correction committed successfully.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    console.error('No correction was committed; the transaction was rolled back.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
