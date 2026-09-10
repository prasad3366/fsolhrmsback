import 'dotenv/config';
import { AttendanceStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const employeeId = 5;
  const attendanceDate = new Date(Date.UTC(2026, 7, 10));
  const clockIn = new Date(2026, 7, 10, 9, 0, 0);
  const clockOut = new Date(2026, 7, 10, 18, 0, 0);

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true, user: { select: { email: true } } },
  });

  if (!employee) {
    throw new Error(`Employee ${employeeId} was not found`);
  }

  await prisma.attendanceRecord.deleteMany({
    where: {
      userId: employee.userId,
      date: { lt: attendanceDate },
      notes: 'August 2026 monthly attendance test record',
    },
  });

  const record = await prisma.attendanceRecord.upsert({
    where: {
      userId_date: {
        userId: employee.userId,
        date: attendanceDate,
      },
    },
    update: {
      userEmail: employee.user.email,
      clockIn,
      clockOut,
      totalHours: 9,
      status: AttendanceStatus.PRESENT,
      isLate: false,
      isEarlyCheckout: false,
      notes: 'August 2026 monthly attendance test record',
    },
    create: {
      userId: employee.userId,
      userEmail: employee.user.email,
      date: attendanceDate,
      clockIn,
      clockOut,
      totalHours: 9,
      status: AttendanceStatus.PRESENT,
      isLate: false,
      isEarlyCheckout: false,
      notes: 'August 2026 monthly attendance test record',
    },
  });

  console.log(`Attendance record ${record.id} is ready for employee ${employeeId}`);
  console.log({
    date: record.date.toISOString().slice(0, 10),
    status: record.status,
    clockIn: record.clockIn.toISOString(),
    clockOut: record.clockOut?.toISOString(),
  });
}

main()
  .catch((error) => {
    console.error('Failed to add August attendance record:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });