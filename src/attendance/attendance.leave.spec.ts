import { AttendanceStatus } from '@prisma/client';
import { AttendanceService } from './attendance.service';

describe('Attendance Leave representation', () => {
  const workingDate = new Date(2026, 8, 4);

  const createService = (status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'CANCELLED', attendance: any[] = []) => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }),
      },
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue(attendance),
      },
      leave: {
        findMany: jest.fn().mockResolvedValue([{
          status,
          startDate: workingDate,
          endDate: workingDate,
        }]),
      },
    } as any;
    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue([workingDate]),
    } as any;
    return new AttendanceService(prisma, {} as any, undefined as any, workingDaysService);
  };

  it('derives approved Leave as LEAVE instead of ABSENT', async () => {
    const service = createService('APPROVED');
    const records = await service.getAttendanceHistory(70, 9, 2026);
    expect(records).toEqual([
      expect.objectContaining({ date: workingDate, status: AttendanceStatus.LEAVE }),
    ]);
  });

  it.each(['PENDING', 'REJECTED', 'CANCELLED'] as const)(
    'keeps %s Leave as inferred ABSENT',
    async (status) => {
      const service = createService(status);
      const records = await service.getAttendanceHistory(70, 9, 2026);
      expect(records).toEqual([
        expect.objectContaining({ date: workingDate, status: AttendanceStatus.ABSENT }),
      ]);
    },
  );

  it('prefers approved leave over an open attendance record on the same date', async () => {
    const service = createService('APPROVED', [{
      userId: 70,
      date: workingDate,
      clockIn: new Date('2026-09-04T09:00:00.000Z'),
      clockOut: null,
      status: AttendanceStatus.IN_PROGRESS,
    }]);
    const records = await service.getAttendanceHistory(70, 9, 2026);
    expect(records).toEqual([
      expect.objectContaining({ date: workingDate, status: AttendanceStatus.LEAVE }),
    ]);
  });

  it('prefers approved leave over a completed attendance record on the same date', async () => {
    const service = createService('APPROVED', [{
      userId: 70,
      date: workingDate,
      clockIn: new Date('2026-09-04T09:00:00.000Z'),
      clockOut: new Date('2026-09-04T17:00:00.000Z'),
      totalHours: 8,
      status: AttendanceStatus.PRESENT,
    }]);
    const records = await service.getAttendanceHistory(70, 9, 2026);
    expect(records).toEqual([
      expect.objectContaining({ date: workingDate, status: AttendanceStatus.LEAVE }),
    ]);
  });

  it('uses the same leave-aware classification in summary and details for approved leave', async () => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
      leave: { findMany: jest.fn().mockResolvedValue([{ status: 'APPROVED', startDate: workingDate, endDate: workingDate }]) },
    } as any;
    const workingDaysService = { getWorkingDates: jest.fn().mockResolvedValue([workingDate]) } as any;
    const service = new AttendanceService(prisma, {} as any, undefined as any, workingDaysService);

    const history = await service.getAttendanceHistory(70, 9, 2026);
    const summary = await service.getEmployeeMonthlySummary(7, '2026-09');

    expect(history).toEqual([
      expect.objectContaining({ date: workingDate, status: AttendanceStatus.LEAVE }),
    ]);
    expect(summary.leaveDays).toBe(1);
    expect(summary.workingDays).toBe(1);
    expect(summary.presentDays).toBe(0);
    expect(summary.absentDays).toBe(0);
  });
});
