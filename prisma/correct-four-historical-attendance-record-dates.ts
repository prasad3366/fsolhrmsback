import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Correction = {
  id: number;
  originalDate: string;
  targetDate: string;
};

const corrections: Correction[] = [
  { id: 7, originalDate: '2026-09-07', targetDate: '2026-09-08' },
  { id: 6, originalDate: '2026-09-06', targetDate: '2026-09-07' },
  { id: 15, originalDate: '2026-09-09', targetDate: '2026-09-10' },
  { id: 10, originalDate: '2026-09-08', targetDate: '2026-09-09' },
];

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function main() {
  const before: Array<{
    id: number;
    userId: number;
    persistedDate: string;
    targetDate: string;
  }> = [];

  const after: Array<{
    id: number;
    userId: number;
    persistedDate: string;
  }> = [];

  await prisma.$transaction(async (tx) => {
    for (const correction of corrections) {
      const record = await tx.attendanceRecord.findUnique({
        where: { id: correction.id },
        select: { id: true, userId: true, date: true },
      });

      if (!record) {
        throw new Error(`ABORT: AttendanceRecord ${correction.id} was not found.`);
      }

      const persistedDate = dateOnly(record.date);
      if (persistedDate !== correction.originalDate) {
        throw new Error(
          `ABORT: AttendanceRecord ${correction.id} has persisted date ${persistedDate}; expected ${correction.originalDate}.`,
        );
      }

      const conflictingRecord = await tx.attendanceRecord.findFirst({
        where: {
          userId: record.userId,
          date: dateValue(correction.targetDate),
          NOT: { id: correction.id },
        },
        select: { id: true },
      });

      if (conflictingRecord) {
        throw new Error(
          `ABORT: target ${record.userId}/${correction.targetDate} is occupied by AttendanceRecord ${conflictingRecord.id}.`,
        );
      }

      before.push({
        id: record.id,
        userId: record.userId,
        persistedDate,
        targetDate: correction.targetDate,
      });

      await tx.attendanceRecord.update({
        where: { id: correction.id },
        data: { date: dateValue(correction.targetDate) },
      });
    }

    for (const correction of corrections) {
      const record = await tx.attendanceRecord.findUnique({
        where: { id: correction.id },
        select: { id: true, userId: true, date: true },
      });

      if (!record || dateOnly(record.date) !== correction.targetDate) {
        throw new Error(
          `ABORT: AttendanceRecord ${correction.id} did not persist target date ${correction.targetDate}.`,
        );
      }

      after.push({
        id: record.id,
        userId: record.userId,
        persistedDate: dateOnly(record.date),
      });
    }
  });

  console.log('Historical AttendanceRecord date correction committed.');
  console.log('Only AttendanceRecord.date was updated.');
  console.log('\nBefore:');
  for (const record of before) {
    console.log(
      `ID ${record.id} | userId ${record.userId} | ${record.persistedDate} -> ${record.targetDate}`,
    );
  }
  console.log('\nAfter:');
  for (const record of after) {
    console.log(
      `ID ${record.id} | userId ${record.userId} | persisted date ${record.persistedDate}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    console.error('No correction was committed; the transaction was rolled back.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
