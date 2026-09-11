import { BadRequestException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import {
  getBusinessDateKey,
  getCurrentDayCutoff,
  getMonthRange,
  toBusinessDate,
} from './utils/business-date.util';

describe('Attendance foundation', () => {
  it('uses Asia/Kolkata for business dates around UTC midnight', () => {
    expect(getBusinessDateKey(new Date('2026-09-10T18:29:59.999Z'))).toBe('2026-09-10');
    expect(getBusinessDateKey(new Date('2026-09-10T18:30:00.000Z'))).toBe('2026-09-11');
    expect(getBusinessDateKey(toBusinessDate(new Date('2026-09-10T18:30:00.000Z')))).toBe('2026-09-11');
    expect(toBusinessDate(new Date('2026-09-10T18:30:00.000Z')).toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('uses the correct Asia/Kolkata month boundaries for January, February, and December into January', () => {
    expect(getBusinessDateKey(getMonthRange(2026, 1).start)).toBe('2026-01-01');
    expect(getBusinessDateKey(getMonthRange(2026, 1).nextStart)).toBe('2026-02-01');
    expect(getBusinessDateKey(getMonthRange(2026, 2).start)).toBe('2026-02-01');
    expect(getBusinessDateKey(getMonthRange(2026, 2).nextStart)).toBe('2026-03-01');
    expect(getBusinessDateKey(getMonthRange(2026, 12).start)).toBe('2026-12-01');
    expect(getBusinessDateKey(getMonthRange(2026, 12).nextStart)).toBe('2027-01-01');
  });

  it('treats 2026-08-31 as August and 2026-09-01 as September in business date calculations', () => {
    expect(getBusinessDateKey(new Date(2026, 7, 31, 23, 59, 59, 999))).toBe('2026-08-31');
    expect(getBusinessDateKey(new Date(2026, 8, 1, 0, 0, 0, 0))).toBe('2026-09-01');
  });

  it('keeps the exact day boundaries for local business dates around midnight and end-of-day', () => {
    expect(getBusinessDateKey(new Date(2026, 8, 10, 0, 0, 0, 0))).toBe('2026-09-10');
    expect(getBusinessDateKey(new Date(2026, 8, 10, 23, 59, 59, 999))).toBe('2026-09-10');
    expect(getBusinessDateKey(new Date('2026-09-10T18:30:00.000Z'))).toBe('2026-09-11');
  });

  it('uses an inclusive month start and exclusive next-month boundary', () => {
    const { start, nextStart } = getMonthRange(2026, 9);
    expect(getBusinessDateKey(start)).toBe('2026-09-01');
    expect(getBusinessDateKey(nextStart)).toBe('2026-10-01');
    expect(getBusinessDateKey(getCurrentDayCutoff(new Date('2026-09-10T18:29:59.999Z')))).toBe('2026-09-11');
  });

  it('derives the server business date for punch-in and rejects historical punch-out dates', async () => {
    const service = new AttendanceService({
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, status: 'ACTIVE', userId: 70, user: { email: 'employee@example.com' } }) },
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => data),
      },
      attendancePolicy: {
        upsert: jest.fn().mockResolvedValue({ shiftStartTime: '09:00', gracePeriodMins: 15 }),
      },
      attendanceLog: { create: jest.fn() },
      wFHRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      officeLocation: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback) => callback({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(({ data }) => data) },
        attendancePolicy: { upsert: jest.fn().mockResolvedValue({ shiftStartTime: '09:00', gracePeriodMins: 15 }) },
        attendanceLog: { create: jest.fn() },
        wFHRequest: { findFirst: jest.fn().mockResolvedValue(null) },
        officeLocation: { findFirst: jest.fn().mockResolvedValue(null) },
      })),
    } as any, { isHoliday: jest.fn().mockResolvedValue(null) } as any);

    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T18:45:00.000Z'));
    try {
      const result = await service.punchIn(7, 1, 2);
      expect(getBusinessDateKey(result.date)).toBe('2026-09-11');
      expect(result.date.toISOString()).toBe('2026-09-11T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }

    await expect(service.clockOut(70, new Date('2026-09-10T00:30:00.000Z'))).rejects.toThrow('Historical clock-out is not allowed');
  });

  it('keeps requested historical months unchanged and does not create future virtual records in current month', async () => {
    const attendanceFindMany = jest.fn().mockResolvedValue([]);
    const service = new AttendanceService({
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: { findMany: attendanceFindMany },
    } as any, {} as any, undefined as any, {
      getWorkingDates: jest.fn().mockResolvedValue([
        new Date(2026, 0, 2),
        new Date(2026, 0, 5),
        new Date(2026, 0, 30),
      ]),
    } as any);

    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 11, 12));
    try {
      await service.getAttendanceHistory(70, 1, 2026);
      expect(attendanceFindMany).toHaveBeenCalledWith({
        where: {
          userId: 70,
          date: {
            gte: new Date(Date.UTC(2026, 0, 1)),
            lt: new Date(Date.UTC(2026, 1, 1)),
          },
        },
        orderBy: { date: 'asc' },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps virtual attendance dates inside the requested month only', async () => {
    const service = new AttendanceService({
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
      leave: { findMany: jest.fn().mockResolvedValue([]) },
    } as any, {} as any, undefined as any, {
      getWorkingDates: jest.fn().mockResolvedValue([
        new Date(2026, 0, 1),
        new Date(2026, 0, 2),
        new Date(2026, 0, 31),
      ]),
    } as any);

    const records = await service.getAttendanceHistory(70, 1, 2026);
    const rows = Array.isArray(records) ? records : records.data;
    expect(rows.every((record) => record.date >= new Date(2026, 0, 1) && record.date < new Date(2026, 1, 1))).toBe(true);
    expect(rows.map((record) => getBusinessDateKey(record.date))).toContain('2026-01-31');
    expect(rows.map((record) => getBusinessDateKey(record.date))).not.toContain('2026-02-01');
  });

  it('persists an open check-in as IN_PROGRESS, never PRESENT', async () => {
    const create = jest.fn().mockResolvedValue({ status: AttendanceStatus.IN_PROGRESS });
    const client = {
      attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null), create },
      attendancePolicy: {
        upsert: jest.fn().mockResolvedValue({ shiftStartTime: '09:00', gracePeriodMins: 15 }),
      },
    };
    const service = new AttendanceService({} as any, {} as any);

    await (service as any).clockInWithClient(client, 1, 'employee@example.com');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clockOut: null,
          totalHours: null,
          status: AttendanceStatus.IN_PROGRESS,
        }),
      }),
    );
    expect(create.mock.calls[0][0].data.status).not.toBe(AttendanceStatus.PRESENT);
  });

  it('rejects a clock-out that would create a non-positive duration', async () => {
    const client = {
      attendanceRecord: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          clockIn: new Date(Date.now() + 60_000),
          clockOut: null,
        }),
      },
    };
    const service = new AttendanceService({} as any, {} as any);

    await expect(
      (service as any).clockOutWithClient(client, 1, new Date(), 'employee@example.com'),
    ).rejects.toThrow(BadRequestException);
  });

  it('projects an open stored final status as IN_PROGRESS in today status', async () => {
    const service = new AttendanceService({
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          clockIn: new Date(Date.now() - 3600000),
          clockOut: null,
          totalHours: null,
          status: AttendanceStatus.PRESENT,
        }),
      },
    } as any, {} as any);

    await expect(service.getTodayStatus(1)).resolves.toEqual(
      expect.objectContaining({
        state: 'IN_PROGRESS',
        status: AttendanceStatus.IN_PROGRESS,
        clockedIn: true,
        clockedOut: false,
      }),
    );
  });

  it('returns an authoritative IN_PROGRESS today-status payload', async () => {
    const service = new AttendanceService({
      employee: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 7, status: 'ACTIVE' })
          .mockResolvedValueOnce({ userId: 1 }),
      },
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue({
          clockIn: new Date(Date.now() - 3600000),
          clockOut: null,
          totalHours: null,
          status: AttendanceStatus.PRESENT,
        }),
      },
    } as any, {} as any);

    await expect(service.getTodayAttendance(7)).resolves.toEqual(
      expect.objectContaining({
        state: 'IN_PROGRESS',
        status: AttendanceStatus.IN_PROGRESS,
        hasPunchedIn: true,
        hasPunchedOut: false,
        punchInTime: expect.any(Date),
        punchOutTime: null,
        clockIn: expect.any(Date),
        clockOut: null,
        totalHours: null,
      }),
    );
  });

  it('returns the canonical NOT_CHECKED_IN today-status payload', async () => {
    const service = new AttendanceService({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, status: 'ACTIVE', userId: 1 }),
      },
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as any, {} as any);

    await expect(service.getTodayAttendance(7)).resolves.toEqual(expect.objectContaining({
      state: 'NOT_CHECKED_IN',
      status: null,
      hasPunchedIn: false,
      hasPunchedOut: false,
      punchInTime: null,
      punchOutTime: null,
      clockIn: null,
      clockOut: null,
    }));
  });

  it('returns the canonical COMPLETED state using duration classification', async () => {
    const clockIn = new Date(Date.now() - 8 * 3600000);
    const clockOut = new Date();
    const service = new AttendanceService({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, status: 'ACTIVE', userId: 1 }),
      },
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue({
          clockIn,
          clockOut,
          totalHours: 8,
          status: AttendanceStatus.IN_PROGRESS,
        }),
      },
    } as any, {} as any);

    await expect(service.getTodayAttendance(7)).resolves.toEqual(expect.objectContaining({
      state: 'COMPLETED',
      status: AttendanceStatus.PRESENT,
      hasPunchedIn: true,
      hasPunchedOut: true,
      punchInTime: clockIn,
      punchOutTime: clockOut,
    }));
  });

  it('returns approved leave as a canonical non-punchable LEAVE state', async () => {
    const service = new AttendanceService({
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, status: 'ACTIVE', userId: 1 }),
      },
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      leave: {
        findMany: jest.fn().mockResolvedValue([{
          status: 'APPROVED',
          startDate: new Date(),
          endDate: new Date(),
        }]),
      },
    } as any, {} as any);

    await expect(service.getTodayAttendance(7)).resolves.toEqual(expect.objectContaining({
      state: 'LEAVE',
      status: AttendanceStatus.LEAVE,
      hasPunchedIn: false,
      hasPunchedOut: false,
      punchInTime: null,
      punchOutTime: null,
    }));
  });

  it('rejects historical checkout through the legacy route compatibility method', async () => {
    const service = new AttendanceService({} as any, {} as any);

    await expect(service.clockOut(1, new Date('2026-09-01T00:00:00.000Z'))).rejects.toThrow(
      'Historical clock-out is not allowed',
    );
  });

  it('uses the single 4/7-hour classifier for completed attendance', () => {
    const service = new AttendanceService({} as any, {} as any);
    expect((service as any).classifyCompletedDuration(0)).toBe(AttendanceStatus.ABSENT);
    expect((service as any).classifyCompletedDuration(3.99)).toBe(AttendanceStatus.ABSENT);
    expect((service as any).classifyCompletedDuration(4)).toBe(AttendanceStatus.HALF_DAY);
    expect((service as any).classifyCompletedDuration(6.99)).toBe(AttendanceStatus.HALF_DAY);
    expect((service as any).classifyCompletedDuration(7)).toBe(AttendanceStatus.PRESENT);
  });
});