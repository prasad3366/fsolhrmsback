import { AttendanceStatus } from '@prisma/client';
import { AttendanceService } from '../attendance/attendance.service';
import { getAttendanceRecordBusinessDateKey, getBusinessDateKey } from '../attendance/utils/business-date.util';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { PayrollService } from './payroll.service';

/* End-to-end attendance -> payroll checks through the real PayrollService,
   AttendanceService and WorkingDaysService over an in-memory database.
   January 2026 payroll covers 29 Dec 2025 - 28 Jan 2026: 23 Mon-Fri days. */

const MONTH = 1;
const YEAR = 2026;
const PERIOD_START = Date.UTC(2025, 11, 29);
const PERIOD_END_EXCLUSIVE = Date.UTC(2026, 0, 29);
const DAY = 24 * 60 * 60 * 1000;

const periodDays = () => {
  const days: string[] = [];
  for (let time = PERIOD_START; time < PERIOD_END_EXCLUSIVE; time += DAY) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
};
const weekday = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();
const WEEKDAYS = periodDays().filter((key) => weekday(key) !== 0 && weekday(key) !== 6);
const SATURDAYS = periodDays().filter((key) => weekday(key) === 6);
const SUNDAYS = periodDays().filter((key) => weekday(key) === 0);

const ist = (key: string, time: string) => new Date(`${key}T${time}:00+05:30`);
const utcDate = (key: string) => new Date(`${key}T00:00:00Z`);

type Range = { gte?: Date; gt?: Date; lt?: Date; lte?: Date };
const inRange = (value: Date | null | undefined, range: Range) => {
  if (!value) return false;
  const time = value.getTime();
  return (range.gte === undefined || time >= range.gte.getTime())
    && (range.gt === undefined || time > range.gt.getTime())
    && (range.lt === undefined || time < range.lt.getTime())
    && (range.lte === undefined || time <= range.lte.getTime());
};
const matchesOr = (row: any, or?: Array<Record<string, Range>>) =>
  !or || or.some((condition) => Object.entries(condition).every(([field, range]) => inRange(row[field], range)));

type Employee = { id: number; userId: number; team?: string };

const createDb = (employees: Employee[]) => {
  const db = {
    attendanceRecords: [] as any[],
    legacyAttendance: [] as any[],
    leaves: [] as any[],
    holidays: new Set<string>(),
    regularizations: [] as any[],
    payrolls: [] as any[],
    auditLogs: [] as any[],
  };
  const employeeRow = (employee: Employee) => ({
    id: employee.id,
    userId: employee.userId,
    status: 'ACTIVE',
    team: employee.team ? { name: employee.team } : null,
    user: { email: `user${employee.userId}@example.com` },
  });

  const prisma: any = {
    employee: {
      findUnique: jest.fn(async ({ where }: any) => {
        const employee = employees.find((row) =>
          where.id !== undefined ? row.id === where.id : row.userId === where.userId);
        return employee ? employeeRow(employee) : null;
      }),
    },
    employeeSalary: {
      findFirst: jest.fn(async () => ({
        id: 1,
        monthlyGross: 23000,
        structure: { basicPercent: 50, hraPercent: 40, conveyanceAmount: 1600, pfPercent: 12, ptAmount: 200 },
      })),
    },
    attendanceRecord: {
      findMany: jest.fn(async ({ where }: any) =>
        db.attendanceRecords.filter((row) => row.userId === where.userId && matchesOr(row, where.OR))),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id !== undefined) return db.attendanceRecords.find((row) => row.id === where.id) ?? null;
        const { userId, date } = where.userId_date;
        return db.attendanceRecords.find((row) => row.userId === userId && row.date.getTime() === date.getTime()) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: db.attendanceRecords.length + 1, ...data };
        db.attendanceRecords.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = db.attendanceRecords.find((record) => record.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    attendance: {
      findMany: jest.fn(async ({ where }: any) =>
        db.legacyAttendance.filter((row) => row.employeeId === where.employeeId && matchesOr(row, where.OR))),
    },
    leave: {
      findMany: jest.fn(async ({ where }: any) => db.leaves.filter((leave) => {
        const statuses = typeof where.status === 'string' ? [where.status] : where.status.in;
        return leave.employeeId === where.employeeId
          && statuses.includes(leave.status)
          && inRange(leave.startDate, where.startDate)
          && inRange(leave.endDate, where.endDate);
      })),
      findFirst: jest.fn(async ({ where }: any) => db.leaves.find((leave) =>
        leave.employeeId === where.employeeId
        && leave.status === where.status
        && inRange(leave.startDate, where.startDate)
        && inRange(leave.endDate, where.endDate)) ?? null),
    },
    attendanceRegularization: {
      findUnique: jest.fn(async ({ where }: any) => db.regularizations.find((row) => row.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = db.regularizations.find((request) => request.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    attendancePolicy: {
      upsert: jest.fn(async () => ({ shiftStartTime: '09:00', shiftEndTime: '18:00', gracePeriodMins: 15, earlyCheckoutMins: 30 })),
    },
    payroll: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        db.payrolls.push(data);
        return data;
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        db.auditLogs.push(data);
        return data;
      }),
    },
  };
  prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));

  const holidayService = { isHoliday: jest.fn(async (date: Date) => db.holidays.has(getBusinessDateKey(date))) } as any;
  const workingDaysService = new WorkingDaysService(prisma, holidayService);
  const authorizationService = { canAccessOrganizationWide: () => true } as any;
  const attendanceService = new AttendanceService(prisma, holidayService, authorizationService, workingDaysService);
  const payrollService = new PayrollService(prisma, {} as any, {} as any, workingDaysService);

  let nextLegacyId = 1;
  const addRecord = (userId: number, key: string, clockIn: string | null, clockOut: string | null, extra: any = {}) =>
    db.attendanceRecords.push({
      id: db.attendanceRecords.length + 1,
      userId,
      userEmail: '',
      date: utcDate(key),
      clockIn: clockIn ? ist(key, clockIn) : null,
      clockOut: clockOut ? ist(key, clockOut) : null,
      status: clockOut ? AttendanceStatus.PRESENT : AttendanceStatus.IN_PROGRESS,
      ...extra,
    });
  const addLegacy = (employeeId: number, key: string, punchIn: string, punchOut: string | null) =>
    db.legacyAttendance.push({
      id: nextLegacyId++,
      employeeId,
      // The pre-cut-over punch flow stored local midnight as the row date
      date: new Date(`${key}T00:00:00+05:30`),
      punchIn: ist(key, punchIn),
      punchOut: punchOut ? ist(key, punchOut) : null,
      totalHours: 0,
      status: AttendanceStatus.PRESENT,
      locationStatus: 'OFFICE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  const addLeave = (employeeId: number, key: string, paidLeaveDays: number, lopDays: number) =>
    db.leaves.push({
      id: db.leaves.length + 1,
      employeeId,
      status: 'APPROVED',
      startDate: utcDate(key),
      endDate: utcDate(key),
      durationType: 'FULL_DAY',
      paidLeaveDays,
      lopDays,
    });
  const runPayroll = (employeeId: number) => payrollService.runPayroll({ employeeId, month: MONTH, year: YEAR } as any);

  return { db, prisma, attendanceService, payrollService, addRecord, addLegacy, addLeave, runPayroll };
};

const EMP = { id: 25, userId: 26 };

describe('Payroll attendance - one universal rule', () => {
  it('sanity: the January 2026 payroll period has 23 weekdays', () => {
    expect(WEEKDAYS).toHaveLength(23);
  });

  it('TEST 1: 23 working days + 23 PRESENT pays the full salary', async () => {
    const env = createDb([EMP]);
    WEEKDAYS.forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));

    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 23, lopDays: 0, leaveDeduction: 0 }));
    expect(payroll.grossSalary).toBe(23000);
  });

  it('TEST 2: 20 PRESENT + 3 genuine absences gives 3 LOP', async () => {
    const env = createDb([EMP]);
    WEEKDAYS.slice(3).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));

    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 20, lopDays: 3, leaveDeduction: 3000 }));
  });

  it('TEST 3: HR Add Missed Attendance counts as a PRESENT payroll day and stays audited', async () => {
    const env = createDb([EMP]);
    const missedDay = WEEKDAYS[5];
    WEEKDAYS.filter((key) => key !== missedDay).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));

    await env.attendanceService.addMissedAttendance(
      { employeeId: EMP.id, date: missedDay, clockIn: ist(missedDay, '09:00').toISOString(), clockOut: ist(missedDay, '18:00').toISOString(), reason: 'server down' },
      { id: 1, email: 'hr@example.com', role: 'HR' } as any,
    );
    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 23, lopDays: 0 }));
    expect(env.db.auditLogs).toEqual([expect.objectContaining({ action: 'MISSED_ATTENDANCE_ADDED', module: 'ATTENDANCE' })]);
  });

  it('TEST 4: a HALF_DAY contributes 0.5', async () => {
    const env = createDb([EMP]);
    WEEKDAYS.forEach((key, index) => env.addRecord(EMP.userId, key, '09:00', index === 0 ? '14:00' : '18:00'));

    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 22.5, lopDays: 0.5 }));
  });

  it('TEST 5: approved paid leave is paid, not LOP', async () => {
    const env = createDb([EMP]);
    WEEKDAYS.slice(1).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));
    env.addLeave(EMP.id, WEEKDAYS[0], 1, 0);

    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 22, paidLeaveDays: 1, lopDays: 0 }));
  });

  it('TEST 6: LOP leave is LOP', async () => {
    const env = createDb([EMP]);
    WEEKDAYS.slice(1).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));
    env.addLeave(EMP.id, WEEKDAYS[0], 0, 1);

    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 22, paidLeaveDays: 0, lopDays: 1 }));
  });

  it('TEST 7: a holiday is not a working day and not LOP', async () => {
    const env = createDb([EMP]);
    env.db.holidays.add(WEEKDAYS[0]);
    WEEKDAYS.slice(1).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));

    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 22, presentDays: 22, lopDays: 0 }));
  });

  it('TEST 8: Sunday attendance keeps the existing non-working-day behaviour', async () => {
    const env = createDb([EMP]);
    WEEKDAYS.slice(1).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));
    env.addRecord(EMP.userId, SUNDAYS[0], '09:00', '18:00');

    const payroll = await env.runPayroll(EMP.id);

    // Working days are unchanged; presence on a non-working day offsets absence LOP as before
    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 23, lopDays: 0 }));
  });

  it('TEST 9: duplicate AttendanceRecords on one business day count once and the highest id wins', async () => {
    const env = createDb([EMP]);
    const day = WEEKDAYS[0];
    WEEKDAYS.slice(1).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));
    // Older row stored on the previous date but checked in on `day`
    env.addRecord(EMP.userId, day, '09:00', '18:00', { date: new Date(utcDate(day).getTime() - DAY) });
    // Newer row for the same business day: a half day
    env.addRecord(EMP.userId, day, '09:00', '14:00');

    const payroll = await env.runPayroll(EMP.id);
    const history = await env.attendanceService.getAttendanceHistoryForDateRange(
      EMP.userId, EMP.id, new Date(PERIOD_START), new Date(PERIOD_END_EXCLUSIVE),
    );

    expect(history.filter((record: any) => getAttendanceRecordBusinessDateKey(record) === day)).toEqual([
      expect.objectContaining({ id: env.db.attendanceRecords.length, status: AttendanceStatus.HALF_DAY }),
    ]);
    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 22.5, lopDays: 0.5 }));
  });

  it('TEST 10: legacy Attendance alone counts in payroll', async () => {
    const env = createDb([EMP]);
    WEEKDAYS.slice(0, 10).forEach((key) => env.addLegacy(EMP.id, key, '09:00', '18:00'));
    // Check-in without check-out on the legacy table is still PRESENT
    env.addLegacy(EMP.id, WEEKDAYS[10], '09:00', null);
    WEEKDAYS.slice(11).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));

    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 23, lopDays: 0 }));
  });

  it('TEST 11: legacy + AttendanceRecord on one business day count once and AttendanceRecord wins', async () => {
    const env = createDb([EMP]);
    WEEKDAYS.forEach((key) => env.addLegacy(EMP.id, key, '09:00', '18:00'));
    WEEKDAYS.slice(1).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));
    // Same day as a full legacy punch, but the current record is a half day
    env.addRecord(EMP.userId, WEEKDAYS[0], '09:00', '14:00');

    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 22.5, lopDays: 0.5 }));
  });

  it('TEST 12 (parity): the attendance screen and payroll agree on every business date', async () => {
    const env = createDb([EMP]);
    const january = WEEKDAYS.filter((key) => key.startsWith('2026-01'));
    january.slice(0, 4).forEach((key) => env.addLegacy(EMP.id, key, '09:00', '18:00')); // legacy only
    env.addLegacy(EMP.id, january[4], '09:00', '18:00'); // legacy overridden below
    env.addRecord(EMP.userId, january[4], '09:00', '12:00'); // ABSENT (< 4h) wins over legacy
    env.addRecord(EMP.userId, january[5], '09:00', '14:00'); // HALF_DAY
    env.addRecord(EMP.userId, january[6], '09:00', null); // check-in only
    // Monday 12 Jan stored on Sunday 11 Jan: belongs to its check-in day
    env.addRecord(EMP.userId, january[7], '09:00', '18:00', { date: new Date(utcDate(january[7]).getTime() - DAY) });
    env.addRecord(EMP.userId, january[8], '09:00', '18:00');
    env.addRecord(EMP.userId, january[8], '09:00', '15:00', { date: new Date(utcDate(january[8]).getTime() + DAY) }); // duplicate, newer
    env.addLeave(EMP.id, january[9], 1, 0);
    env.addRecord(EMP.userId, SUNDAYS.find((key) => key.startsWith('2026-01'))!, '10:00', '18:00');
    env.db.holidays.add(january[10]);

    const screen = await env.attendanceService.getAttendanceHistory(EMP.userId, 1, 2026) as any[];
    const payroll = await env.attendanceService.getAttendanceHistoryForDateRange(
      EMP.userId, EMP.id, new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 1, 1)),
    );

    const screenByDay = new Map(screen.map((record) => [getAttendanceRecordBusinessDateKey(record), record.status]));
    const payrollByDay = new Map(payroll.map((record: any) => [getAttendanceRecordBusinessDateKey(record), record.status]));

    expect(screen).toHaveLength(screenByDay.size); // one row per business day
    for (const [key, status] of screenByDay) {
      const payrollStatus = payrollByDay.get(key);
      if (payrollStatus === undefined) {
        // No attendance for payroll: the screen shows an absence or leave, never a worked day
        expect([key, [AttendanceStatus.ABSENT, AttendanceStatus.LEAVE].includes(status)]).toEqual([key, true]);
      } else {
        expect([key, payrollStatus]).toEqual([key, status]);
      }
    }
    for (const [key, status] of payrollByDay) {
      expect([key, screenByDay.get(key)]).toEqual([key, status]);
    }
    expect(screenByDay.get(january[0])).toBe(AttendanceStatus.PRESENT);
    expect(screenByDay.get(january[4])).toBe(AttendanceStatus.ABSENT);
    expect(screenByDay.get(january[5])).toBe(AttendanceStatus.HALF_DAY);
    expect(screenByDay.get(january[6])).toBe(AttendanceStatus.PRESENT);
    expect(screenByDay.get(january[7])).toBe(AttendanceStatus.PRESENT);
    expect(screenByDay.get(january[8])).toBe(AttendanceStatus.HALF_DAY);
    expect(screenByDay.get(january[9])).toBe(AttendanceStatus.LEAVE);
    expect(screenByDay.has(january[10])).toBe(false); // holiday: no inferred absence
  });

  it('TEST 13: multiple employees with different schedules follow the same rule', async () => {
    const office = { id: 31, userId: 41 };
    const sales = { id: 32, userId: 42, team: 'Sales' };
    const env = createDb([office, sales]);
    WEEKDAYS.forEach((key) => env.addRecord(office.userId, key, '09:00', '18:00'));
    [...WEEKDAYS, ...SATURDAYS].forEach((key, index) =>
      index % 2 ? env.addRecord(sales.userId, key, '09:00', '18:00') : env.addLegacy(sales.id, key, '09:00', '18:00'));

    const officePayroll = await env.runPayroll(office.id);
    const salesPayroll = await env.runPayroll(sales.id);

    expect(officePayroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 23, lopDays: 0 }));
    expect(salesPayroll).toEqual(expect.objectContaining({
      workingDays: 23 + SATURDAYS.length,
      presentDays: 23 + SATURDAYS.length,
      lopDays: 0,
    }));
  });

  it('TEST 14: an approved regularization reaches payroll', async () => {
    const env = createDb([EMP]);
    WEEKDAYS.slice(1).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));
    env.addRecord(EMP.userId, WEEKDAYS[0], '09:00', '11:00'); // 2h -> ABSENT
    const recordId = env.db.attendanceRecords.length;

    expect(await env.runPayroll(EMP.id)).toEqual(expect.objectContaining({ presentDays: 22, lopDays: 1 }));

    env.db.regularizations.push({
      id: 1,
      attendanceRecordId: recordId,
      userId: EMP.userId,
      requestedClockIn: ist(WEEKDAYS[0], '09:00'),
      requestedClockOut: ist(WEEKDAYS[0], '18:00'),
      status: 'PENDING',
    });
    await env.attendanceService.processRegularization(1, 'APPROVED' as any, 'hr@example.com');

    expect(await env.runPayroll(EMP.id)).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 23, lopDays: 0 }));
  });

  it('TEST 15: check-in without check-out is PRESENT with no LOP', async () => {
    const env = createDb([EMP]);
    WEEKDAYS.forEach((key, index) => env.addRecord(EMP.userId, key, '09:00', index === 0 ? null : '18:00'));

    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 23, lopDays: 0 }));
  });

  it('TEST 16: legacy check-ins just after IST midnight land on the right side of both period boundaries', async () => {
    const env = createDb([EMP]);
    const first = WEEKDAYS[0]; // Mon 29 Dec 2025, 00:15 IST is still 28 Dec in UTC
    const last = WEEKDAYS[WEEKDAYS.length - 1]; // Wed 28 Jan 2026
    WEEKDAYS.slice(1, -1).forEach((key) => env.addRecord(EMP.userId, key, '09:00', '18:00'));
    env.addLegacy(EMP.id, first, '00:15', null);
    env.addLegacy(EMP.id, last, '23:30', null);
    // 00:15 IST on 29 Jan is still 28 Jan in UTC but belongs to the next period
    env.addLegacy(EMP.id, '2026-01-29', '00:15', '18:00');

    const payroll = await env.runPayroll(EMP.id);

    expect(payroll).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 23, lopDays: 0 }));
  });

  it('TEST 17: a historical payroll stored with no attendance: preview and recalculation give the same figures as the attendance screen', async () => {
    const env = createDb([EMP]);
    // A June-style period held only in the legacy table, with some check-ins missing a check-out
    WEEKDAYS.slice(0, 20).forEach((key, index) => env.addLegacy(EMP.id, key, '09:00', index % 4 ? '18:00' : null));
    const fresh = await env.runPayroll(EMP.id);
    // What the AttendanceRecord-only calculation stored for this period
    const stored = { ...fresh, id: 7, status: 'DRAFT', presentDays: 0, lopDays: 23, leaveDeduction: 23000, others: [] };
    env.prisma.payroll.findUnique = jest.fn(async () => ({ ...stored }));
    env.prisma.payroll.update = jest.fn(async ({ data }: any) => ({ ...stored, ...data }));

    const preview = await env.payrollService.previewRecalculation(7);
    const recalculated = await env.payrollService.recalculatePayroll(7, { id: 1, role: 'HR', email: 'hr@example.com' } as any);

    expect(preview.recalculated).toEqual(expect.objectContaining({ workingDays: 23, presentDays: 20, lopDays: 3 }));
    for (const [field, value] of Object.entries(preview.recalculated)) {
      expect([field, (recalculated as any)[field]]).toEqual([field, value]);
    }
    expect(preview.historicalAdjustments.blocksRecalculation).toBe(false);

    const screenPresent = (await env.attendanceService.getAttendanceHistory(EMP.userId, 1, 2026) as any[])
      .filter((record) => record.status === AttendanceStatus.PRESENT).length;
    const decemberPresent = (await env.attendanceService.getAttendanceHistory(EMP.userId, 12, 2025) as any[])
      .filter((record) => getAttendanceRecordBusinessDateKey(record) >= '2025-12-29' && record.status === AttendanceStatus.PRESENT).length;
    expect(screenPresent + decemberPresent).toBe(recalculated.presentDays);
  });
});
