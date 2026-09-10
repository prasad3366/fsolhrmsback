import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';

describe('AttendanceService target summary', () => {
  const prisma = {
    employee: { findUnique: jest.fn(), findFirst: jest.fn() },
    attendanceRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    attendance: { findMany: jest.fn() },
    leave: { findMany: jest.fn() },
  } as any;

  const holidayService = {
    isHoliday: jest.fn(),
  } as any;

  it('allows an employee to access only their own attendance summary', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValue(true),
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);
    const employeeSpy = jest.spyOn(service, 'getEmployeeMonthlySummary').mockResolvedValue({
      employeeId: 7,
      month: '2026-09',
      workingDays: 20,
      presentDays: 15,
      halfDays: 1,
      leaveDays: 2,
      absentDays: 2,
      presentEquivalentDays: 15.5,
      attendancePercentage: 77.5,
    } as any);

    await expect(
      service.getTargetEmployeeAttendanceSummary({ id: 1, role: 'EMPLOYEE', employeeId: 7 }, 7, '2026-09'),
    ).resolves.toEqual(expect.objectContaining({ month: '2026-09', employeeId: 7 }));

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(
      { id: 1, role: 'EMPLOYEE', employeeId: 7 },
      7,
    );
    expect(employeeSpy).toHaveBeenCalledWith(7, '2026-09');
  });

  it('denies an employee access to another employee attendance summary', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValue(false),
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(
      service.getTargetEmployeeAttendanceSummary({ id: 1, role: 'EMPLOYEE', employeeId: 7 }, 8, '2026-09'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('permits IT_MANAGER for assigned-team employees and denies outside-team access', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);
    const getSpy = jest.spyOn(service, 'getEmployeeMonthlySummary').mockResolvedValue({
      employeeId: 9,
      month: '2026-09',
      workingDays: 20,
      presentDays: 15,
      halfDays: 1,
      leaveDays: 2,
      absentDays: 2,
      presentEquivalentDays: 15.5,
      attendancePercentage: 77.5,
    } as any);

    await expect(
      service.getTargetEmployeeAttendanceSummary({ id: 1, role: 'IT_MANAGER', employeeId: 10 }, 9, '2026-09'),
    ).resolves.toEqual(expect.objectContaining({ employeeId: 9 }));

    await expect(
      service.getTargetEmployeeAttendanceSummary({ id: 1, role: 'IT_MANAGER', employeeId: 10 }, 11, '2026-09'),
    ).rejects.toThrow(ForbiddenException);

    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('denies FINANCE_MANAGER attendance access even when the raw employee check would otherwise pass', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValue(true),
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(
      service.getTargetEmployeeAttendanceSummary({ id: 1, role: 'FINANCE_MANAGER', employeeId: 10 }, 7, '2026-09'),
    ).rejects.toThrow(ForbiddenException);

    expect(authorizationService.canAccessEmployee).not.toHaveBeenCalled();
  });
});

describe('AttendanceService employee scope', () => {
  const employeeFindMany = jest.fn();
  const teamFindMany = jest.fn();
  const prisma = {
    employee: { findMany: employeeFindMany },
    team: { findMany: teamFindMany },
  } as any;
  const holidayService = { isHoliday: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    employeeFindMany.mockResolvedValue([]);
    teamFindMany.mockResolvedValue([{ id: 2 }]);
  });

  it('scopes manager search by teamId and never designation', async () => {
    const service = new AttendanceService(prisma, holidayService);

    await service.getAttendanceEmployees(
      { user: { employeeId: 11, role: 'SALES_MANAGER' } },
      'Sales',
    );

    expect(teamFindMany).toHaveBeenCalledWith({
      where: { managerId: 11 },
      select: { id: true },
    });
    expect(employeeFindMany.mock.calls[0][0].where).toEqual({
      AND: [
        { teamId: { in: [2] } },
        expect.objectContaining({ OR: expect.any(Array) }),
      ],
    });
    expect(employeeFindMany.mock.calls[0][0].where.AND[1].OR).not.toContainEqual(
      expect.objectContaining({ designation: expect.anything() }),
    );
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s to search active employees organization-wide', async (role) => {
    const service = new AttendanceService(prisma, holidayService);

    await service.getAttendanceEmployees({ user: { employeeId: 1, role } }, '7');

    expect(teamFindMany).not.toHaveBeenCalled();
    expect(employeeFindMany.mock.calls[0][0].where.AND[0]).toEqual({ status: 'ACTIVE' });
  });

  it('restricts employees to their own active employee record', async () => {
    const service = new AttendanceService(prisma, holidayService);

    await service.getAttendanceEmployees({ user: { employeeId: 7, role: 'EMPLOYEE' } });

    expect(employeeFindMany.mock.calls[0][0].where).toEqual({
      id: 7,
    });
    expect(teamFindMany).not.toHaveBeenCalled();
  });

  it('fails closed for an unknown role', async () => {
    const service = new AttendanceService(prisma, holidayService);

    await expect(
      service.getAttendanceEmployees({ user: { employeeId: 7, role: 'UNKNOWN' } }),
    ).rejects.toThrow(ForbiddenException);
    expect(employeeFindMany).not.toHaveBeenCalled();
  });
});

describe('AttendanceService punch transactions', () => {
  const holidayService = { isHoliday: jest.fn() } as any;
  const authorizationService = { canAccessEmployee: jest.fn() } as any;
  const attendanceRecord = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 2 }),
    update: jest.fn().mockResolvedValue({ id: 2 }),
  });
  const attendancePolicy = {
    upsert: jest.fn().mockResolvedValue({
      shiftStartTime: '09:00',
      shiftEndTime: '18:00',
      gracePeriodMins: 15,
      earlyCheckoutMins: 30,
      halfDayHours: 4,
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    holidayService.isHoliday.mockResolvedValue(null);
    authorizationService.canAccessEmployee.mockResolvedValue(true);
  });

  it('commits the normal punch-in log and Attendance upsert together', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendanceUpsert = jest.fn().mockResolvedValue({ id: 2 });
    const transaction = jest.fn(async (callback) => callback({
      attendanceLog: { create: attendanceLogCreate },
      attendance: { findUnique: jest.fn().mockResolvedValue(null), upsert: attendanceUpsert },
    }));
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70, status: 'ACTIVE', user: { email: 'test@example.com' } }) },
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      attendancePolicy,
      attendance: { findUnique: jest.fn().mockResolvedValue(null) },
      attendanceLog: { create: jest.fn() },
      wFHRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      officeLocation: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: transaction,
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(service.punchIn(7, 1, 2)).resolves.toEqual({ id: 2 });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(attendanceLogCreate).toHaveBeenCalledWith({ data: { employeeId: 7, type: 'IN' } });
    expect(attendanceUpsert).toHaveBeenCalledTimes(1);
  });

  it('rolls back the punch-in transaction when Attendance upsert fails', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendanceUpsert = jest.fn().mockRejectedValue(new Error('attendance write failed'));
    let committed = false;
    const transaction = jest.fn(async (callback) => {
      try {
        const result = await callback({
          attendanceLog: { create: attendanceLogCreate },
          attendance: { findUnique: jest.fn().mockResolvedValue(null), upsert: attendanceUpsert },
        });
        committed = true;
        return result;
      } catch (error) {
        throw error;
      }
    });
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70, status: 'ACTIVE', user: { email: 'test@example.com' } }) },
      attendanceRecord: attendanceRecord(),
      attendancePolicy,
      attendance: { findUnique: jest.fn().mockResolvedValue(null) },
      wFHRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      officeLocation: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: transaction,
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(service.punchIn(7, 1, 2)).rejects.toThrow('attendance write failed');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(attendanceLogCreate).toHaveBeenCalledTimes(1);
    expect(committed).toBe(false);
  });

  it('commits the normal punch-out log and Attendance update together', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendanceUpdate = jest.fn().mockResolvedValue({ id: 2 });
    const transaction = jest.fn(async (callback) => callback({
      attendanceLog: { create: attendanceLogCreate },
      attendance: { findUnique: jest.fn().mockResolvedValue({ id: 2, punchIn: new Date(), punchOut: null }), update: attendanceUpdate },
    }));
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70, status: 'ACTIVE', user: { email: 'test@example.com' } }) },
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      attendancePolicy,
      attendance: {
        findUnique: jest.fn().mockResolvedValue({ id: 2, punchIn: new Date(Date.now() - 8 * 3600000) }),
      },
      $transaction: transaction,
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(service.punchOut(7, 1, 2)).resolves.toEqual({ id: 2 });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(attendanceLogCreate).toHaveBeenCalledWith({ data: { employeeId: 7, type: 'OUT' } });
    expect(attendanceUpdate).toHaveBeenCalledTimes(1);
  });

  it('creates a fallback attendance record when punch-out has no punch-in record', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendanceUpsert = jest.fn().mockResolvedValue({ id: 2, punchOut: expect.any(Date) });
    const transaction = jest.fn(async (callback) => callback({
      attendanceLog: { create: attendanceLogCreate },
      attendance: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: attendanceUpsert,
      },
    }));
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          userId: 70,
          status: 'ACTIVE',
        }),
      },
      attendanceRecord: attendanceRecord(),
      attendancePolicy,
      $transaction: transaction,
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(service.punchOut(7, 1, 2)).resolves.toEqual(
      expect.objectContaining({ id: 2 }),
    );

    expect(attendanceLogCreate).toHaveBeenCalledWith({
      data: { employeeId: 7, type: 'OUT' },
    });
    expect(attendanceUpsert).toHaveBeenCalledWith({
      where: expect.objectContaining({ employeeId_date: expect.objectContaining({ employeeId: 7 }) }),
      update: expect.objectContaining({ punchOut: expect.any(Date) }),
      create: expect.objectContaining({
        employeeId: 7,
        punchIn: expect.any(Date),
        punchOut: expect.any(Date),
        totalHours: 0,
      }),
    });
  });

  it('rolls back the punch-out transaction when Attendance update fails', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendanceUpdate = jest.fn().mockRejectedValue(new Error('attendance update failed'));
    let committed = false;
    const transaction = jest.fn(async (callback) => {
      try {
        const result = await callback({
          attendanceLog: { create: attendanceLogCreate },
          attendance: { findUnique: jest.fn().mockResolvedValue({ id: 2, punchIn: new Date(), punchOut: null }), update: attendanceUpdate },
        });
        committed = true;
        return result;
      } catch (error) {
        throw error;
      }
    });
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70, status: 'ACTIVE', user: { email: 'test@example.com' } }) },
      attendanceRecord: attendanceRecord(),
      attendancePolicy,
      attendance: {
        findUnique: jest.fn().mockResolvedValue({ id: 2, punchIn: new Date(Date.now() - 8 * 3600000) }),
      },
      $transaction: transaction,
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(service.punchOut(7, 1, 2)).rejects.toThrow('attendance update failed');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(attendanceLogCreate).toHaveBeenCalledTimes(1);
    expect(committed).toBe(false);
  });

  it('preserves duplicate punch-in and punch-out errors before opening a transaction', async () => {
    const transaction = jest.fn();
    const prisma = {
      employee: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 7, userId: 70, status: 'ACTIVE', user: { email: 'test@example.com' } })
          .mockResolvedValueOnce({ id: 7, userId: 70, status: 'ACTIVE', user: { email: 'test@example.com' } }),
      },
      attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      attendancePolicy,
      attendance: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ punchIn: new Date() })
          .mockResolvedValueOnce({ id: 2, punchIn: new Date(), punchOut: new Date() }),
      },
      $transaction: transaction,
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(service.punchIn(7)).rejects.toThrow(BadRequestException);
    await expect(service.punchOut(7)).rejects.toThrow(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects inactive punch-in before holiday checks, location lookup, or writes', async () => {
    const holidayCheck = jest.fn();
    const transaction = jest.fn();
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, status: 'INACTIVE' }) },
      attendanceRecord: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      attendance: { findUnique: jest.fn(), upsert: jest.fn() },
      attendanceLog: { create: jest.fn() },
      wFHRequest: { findFirst: jest.fn() },
      officeLocation: { findFirst: jest.fn() },
      $transaction: transaction,
    } as any;
    const service = new AttendanceService(prisma, { isHoliday: holidayCheck } as any, authorizationService);

    await expect(service.punchIn(7, 1, 2)).rejects.toThrow(ForbiddenException);

    expect(holidayCheck).not.toHaveBeenCalled();
    expect(prisma.attendance.findUnique).not.toHaveBeenCalled();
    expect(prisma.wFHRequest.findFirst).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects inactive punch-out before attendance lookup or transaction', async () => {
    const transaction = jest.fn();
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, status: 'INACTIVE' }) },
      attendanceRecord: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      attendance: { findUnique: jest.fn() },
      attendanceLog: { create: jest.fn() },
      $transaction: transaction,
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(service.punchOut(7, 1, 2)).rejects.toThrow(ForbiddenException);

    expect(prisma.attendance.findUnique).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects inactive current attendance before reading today status', async () => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, status: 'INACTIVE' }) },
      attendanceRecord: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      attendance: { findUnique: jest.fn() },
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(service.getTodayAttendance(7)).rejects.toThrow(ForbiddenException);

    expect(prisma.attendance.findUnique).not.toHaveBeenCalled();
  });
});

describe('AttendanceService historical reads', () => {
  it.each([
    [3 + 59 / 60, AttendanceStatus.ABSENT],
    [4, AttendanceStatus.HALF_DAY],
    [6 + 59 / 60, AttendanceStatus.HALF_DAY],
    [7, AttendanceStatus.PRESENT],
    [8, AttendanceStatus.PRESENT],
  ])('calculates persisted checkout status at %s hours', async (hours, status) => {
    const clockOut = new Date('2026-09-09T17:00:00.000Z');
    const attendanceRecordUpdate = jest.fn().mockResolvedValue({ id: 1, status });
    const service = new AttendanceService({} as any, {} as any);
    const client = {
      attendanceRecord: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          clockIn: new Date(clockOut.getTime() - hours * 3600000),
          clockOut: null,
          isLate: false,
        }),
        update: attendanceRecordUpdate,
      },
      attendancePolicy: {
        upsert: jest.fn().mockResolvedValue({
          shiftEndTime: '18:00',
          earlyCheckoutMins: 30,
        }),
      },
    };

    jest.useFakeTimers().setSystemTime(clockOut);
    try {
      await (service as any).clockOutWithClient(client, 70, clockOut, 'test@example.com');
    } finally {
      jest.useRealTimers();
    }

    expect(attendanceRecordUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        clockOut,
        totalHours: expect.closeTo(hours, 8),
        status,
      }),
    });
  });

  it('resolves today status from the authenticated employee identity', async () => {
    const employeeFindUnique = jest.fn().mockResolvedValue({ id: 7, userId: 70 });
    const attendanceFindUnique = jest.fn().mockResolvedValue(null);
    const service = new AttendanceService({
      employee: { findUnique: employeeFindUnique },
      attendanceRecord: { findUnique: attendanceFindUnique },
    } as any, {} as any);

    await expect(service.getTodayStatusForEmployee(7)).resolves.toEqual({
      clockedIn: false,
      clockedOut: false,
      durationElapsed: 0,
    });

    expect(employeeFindUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { userId: true },
    });
    expect(attendanceFindUnique).toHaveBeenCalledWith({
      where: { userId_date: expect.objectContaining({ userId: 70 }) },
    });
  });

  it('paginates the completed current-month result newest first with metadata', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 30, 12));
    const presentDate = new Date(2026, 8, 29);
    const olderDate = new Date(2026, 8, 3);
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 70, date: presentDate, status: AttendanceStatus.PRESENT, totalHours: 8 },
          { userId: 70, date: olderDate, status: AttendanceStatus.HALF_DAY, totalHours: 5 },
        ]),
      },
    } as any;
    const workingDaysService = { getWorkingDates: jest.fn().mockResolvedValue([]) } as any;
    const service = new AttendanceService(prisma, {} as any, undefined, workingDaysService);

    try {
      await expect(service.getAttendanceHistory(70, 9, 2026, undefined, 1, 1)).resolves.toEqual({
        data: [expect.objectContaining({ date: presentDate })],
        meta: { page: 1, pageSize: 1, total: 2, totalPages: 2, month: 9, year: 2026 },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('generates virtual absences before applying pagination', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 3, 12));
    const presentDate = new Date(2026, 8, 2);
    const absentDate = new Date(2026, 8, 1);
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 70, date: presentDate, status: AttendanceStatus.PRESENT, totalHours: 8 },
        ]),
      },
    } as any;
    const workingDaysService = { getWorkingDates: jest.fn().mockResolvedValue([absentDate, presentDate]) } as any;
    const service = new AttendanceService(prisma, {} as any, undefined, workingDaysService);

    try {
      const result = await service.getAttendanceHistory(70, 9, 2026, undefined, 2, 1);
      expect(result).toEqual(expect.objectContaining({
        meta: { page: 2, pageSize: 1, total: 2, totalPages: 2, month: 9, year: 2026 },
      }));
      expect((result as any).data[0]).toEqual(expect.objectContaining({
        date: absentDate,
        clockIn: null,
        clockOut: null,
        status: AttendanceStatus.ABSENT,
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps inactive employee attendance history readable', async () => {
    const attendance = [{ id: 1, employeeId: 7, date: new Date('2026-08-01') }];
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70, status: 'INACTIVE' }) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue(attendance), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      attendance: { findMany: jest.fn().mockResolvedValue(attendance) },
    } as any;
    const service = new AttendanceService(prisma, { isHoliday: jest.fn() } as any);

    await expect(service.getMyAttendanceForEmployee(7)).resolves.toEqual(attendance);
    expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith({
      where: { userId: 70 },
      orderBy: { date: 'asc' },
    });
  });

  it('filters monthly attendance by status and orders it chronologically', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 7, 12));
    const prisma = {
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new AttendanceService(prisma, {} as any);

    try {
      await service.getAttendanceHistory(70, 9, 2026, AttendanceStatus.PRESENT);

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith({
        where: {
          userId: 70,
          date: {
            gte: new Date(2026, 8, 1),
            lte: new Date(2026, 8, 7, 23, 59, 59, 999),
          },
          status: AttendanceStatus.PRESENT,
        },
        orderBy: { date: 'asc' },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the next month start as an exclusive historical upper boundary', async () => {
    const attendanceFindMany = jest.fn().mockResolvedValue([]);
    const service = new AttendanceService({
      attendanceRecord: { findMany: attendanceFindMany },
    } as any, {} as any);

    await service.getAttendanceHistory(70, 1, 2026, undefined);

    expect(attendanceFindMany).toHaveBeenCalledWith({
      where: {
        userId: 70,
        date: {
          gte: new Date(2026, 0, 1),
          lt: new Date(2026, 1, 1),
        },
      },
      orderBy: { date: 'asc' },
    });
  });

  it('supports unfiltered and status-only employee history queries', async () => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new AttendanceService(prisma, {} as any);

    await service.getMyAttendanceForEmployee(7);
    await service.getMyAttendanceForEmployee(7, undefined, undefined, AttendanceStatus.HALF_DAY);

    expect(prisma.attendanceRecord.findMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 70 },
      orderBy: { date: 'asc' },
    });
    expect(prisma.attendanceRecord.findMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 70, status: AttendanceStatus.HALF_DAY },
      orderBy: { date: 'asc' },
    });
  });

  it('returns virtual absences for missing working-day records', async () => {
    const presentDate = new Date(2026, 8, 1);
    const absentDate = new Date(2026, 8, 2);
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 7 }),
      },
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 70,
            date: presentDate,
            clockIn: new Date(2026, 8, 1, 9),
            clockOut: new Date(2026, 8, 1, 18),
            status: AttendanceStatus.PRESENT,
          },
        ]),
      },
    } as any;
    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue([presentDate, absentDate]),
    } as any;
    const service = new AttendanceService(
      prisma,
      {} as any,
      undefined as any,
      workingDaysService,
    );

    await expect(
      service.getAttendanceHistory(70, 9, 2026, AttendanceStatus.ABSENT),
    ).resolves.toEqual([
      expect.objectContaining({
        userId: 70,
        date: absentDate,
        status: AttendanceStatus.ABSENT,
        clockIn: null,
        clockOut: null,
        totalHours: 0,
      }),
    ]);
    expect(workingDaysService.getWorkingDates).toHaveBeenCalledWith(
      7,
      expect.arrayContaining([presentDate, absentDate]),
    );
  });

  it('does not generate future dates in the current month', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 7, 12));
    try {
      const prisma = {
        employee: {
          findUnique: jest.fn().mockResolvedValue({ id: 7 }),
        },
        attendanceRecord: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      } as any;
      const workingDaysService = {
        getWorkingDates: jest.fn().mockImplementation((_employeeId, dates: Date[]) => dates),
      } as any;
      const service = new AttendanceService(
        prisma,
        {} as any,
        undefined as any,
        workingDaysService,
      );

      const records = await service.getAttendanceHistory(70, 9, 2026) as any[];

      expect(records.every((record) => record.date <= new Date(2026, 8, 7, 23, 59, 59, 999))).toBe(true);
      expect(workingDaysService.getWorkingDates).toHaveBeenCalledWith(
        7,
        expect.arrayContaining([new Date(2026, 8, 7)]),
      );
      expect(workingDaysService.getWorkingDates.mock.calls[0][1]).not.toContainEqual(
        new Date(2026, 8, 8),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('AttendanceService shared working-day integration', () => {
  const createService = (workingDates: Date[]) => {
    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue(workingDates),
    } as any;
    const holidayService = { isHoliday: jest.fn() } as any;
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      attendance: { findMany: jest.fn() },
      leave: { findMany: jest.fn() },
    } as any;
    const service = new AttendanceService(
      prisma,
      holidayService,
      { canAccessEmployee: jest.fn() } as any,
      workingDaysService,
    );

    return { service, prisma, workingDaysService };
  };

  it('uses the shared working dates for a normal employee summary', async () => {
    const workingDates = [new Date(2026, 7, 3), new Date(2026, 7, 4)];
    const { service, prisma, workingDaysService } = createService(workingDates);
    prisma.attendanceRecord.findMany.mockResolvedValue([]);
    prisma.leave.findMany.mockResolvedValue([]);

    const result = await service.getEmployeeMonthlySummary(7, '2026-08');

    expect(workingDaysService.getWorkingDates).toHaveBeenCalled();
    expect(result.workingDays).toBe(2);
  });

  it('preserves the working-day invariant with present, half-day, absent, and leave dates', async () => {
    const workingDates = [
      new Date(2026, 7, 3),
      new Date(2026, 7, 4),
      new Date(2026, 7, 5),
    ];
    const { service, prisma } = createService(workingDates);
    prisma.attendanceRecord.findMany.mockResolvedValue([
      { date: new Date(2026, 7, 3), status: 'PRESENT' },
      { date: new Date(2026, 7, 4), status: 'HALF_DAY' },
    ]);
    prisma.leave.findMany.mockResolvedValue([
      {
        startDate: new Date(2026, 7, 5),
        endDate: new Date(2026, 7, 5),
        durationType: 'FULL_DAY',
        totalDays: 1,
      },
    ]);

    const result = await service.getEmployeeMonthlySummary(7, '2026-08');

    expect(result.workingDays).toBe(
      result.presentDays + result.halfDays + result.absentDays + result.leaveDays,
    );
    expect(result.presentDays).toBe(1);
    expect(result.halfDays).toBe(1);
    expect(result.leaveDays).toBe(1);
  });

  it.each([
    ['normal', null, 21],
    ['Sales', 'SALES', 26],
  ])('uses the shared weekday rule for %s August 2026 attendance', async (_label, teamName, expectedWorkingDays) => {
    const holidayService = { isHoliday: jest.fn().mockResolvedValue(null) } as any;
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          userId: 70,
          team: teamName ? { name: teamName } : null,
        }),
      },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      leave: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const workingDaysService = new WorkingDaysService(prisma, holidayService);
    const service = new AttendanceService(prisma, holidayService, undefined as any, workingDaysService);

    const result = await service.getEmployeeMonthlySummary(7, '2026-08');

    expect(result.workingDays).toBe(expectedWorkingDays);
  });

  it('excludes a holiday for both a normal employee and a Sales Saturday', async () => {
    const salesSaturday = new Date(2026, 7, 1);
    const holidayService = {
      isHoliday: jest.fn(async (date: Date) =>
        date.getTime() === salesSaturday.getTime() ? { date } : null,
      ),
    } as any;
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70, team: { name: 'SALES' } }),
      },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      leave: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const workingDaysService = new WorkingDaysService(prisma, holidayService);
    const service = new AttendanceService(prisma, holidayService, undefined as any, workingDaysService);

    const result = await service.getEmployeeMonthlySummary(7, '2026-08');

    expect(result.workingDays).toBe(25);
  });
});

describe('AttendanceService WFH location working-day integration', () => {
  const formatDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const createService = ({
    teamName,
    holidayDates = [],
    approvedWfh = false,
  }: {
    teamName: string | null;
    holidayDates?: string[];
    approvedWfh?: boolean;
  }) => {
    const holidayService = {
      isHoliday: jest.fn(async (date: Date) =>
        holidayDates.includes(formatDate(date)) ? { date } : null,
      ),
    } as any;
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          userId: 70,
          status: 'ACTIVE',
          team: teamName ? { name: teamName } : null,
          user: { email: 'test@example.com' },
        }),
      },
      attendanceRecord: { findMany: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 2, clockIn: new Date() }), update: jest.fn() },
      attendancePolicy: { upsert: jest.fn().mockResolvedValue({ shiftStartTime: '09:00', shiftEndTime: '18:00', gracePeriodMins: 15, earlyCheckoutMins: 30, halfDayHours: 4 }) },
      attendance: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }: any) => ({
          ...create,
          id: 1,
        })),
      },
      attendanceLog: { create: jest.fn() },
      wFHRequest: {
        findFirst: jest.fn().mockResolvedValue(
          approvedWfh ? { id: 1, status: 'APPROVED' } : null,
        ),
      },
      officeLocation: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(prisma)),
    } as any;
    const workingDaysService = new WorkingDaysService(prisma, holidayService);
    const service = new AttendanceService(
      prisma,
      holidayService,
      undefined as any,
      workingDaysService,
    );

    return { service, prisma, workingDaysService };
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['Monday', new Date(2026, 8, 7)],
    ['Friday', new Date(2026, 8, 4)],
  ])('sets WFH for approved normal-team %s', async (_label, date) => {
    jest.setSystemTime(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9));
    const { service } = createService({ teamName: null, approvedWfh: true });

    await expect(service.punchIn(7, 1, 2)).resolves.toEqual(
      expect.objectContaining({ locationStatus: 'WFH' }),
    );
  });

  it('does not set WFH for approved normal-team Saturday', async () => {
    jest.setSystemTime(new Date(2026, 8, 5, 9));
    const { service, prisma } = createService({ teamName: null, approvedWfh: true });

    await expect(service.punchIn(7, 1, 2)).resolves.toEqual(
      expect.objectContaining({ locationStatus: 'OUTSIDE' }),
    );
    expect(prisma.wFHRequest.findFirst).not.toHaveBeenCalled();
  });

  it('does not set WFH for approved Sunday', async () => {
    jest.setSystemTime(new Date(2026, 8, 6, 9));
    const { service, prisma } = createService({ teamName: null, approvedWfh: true });

    await expect(service.punchIn(7, 1, 2)).resolves.toEqual(
      expect.objectContaining({ locationStatus: 'OUTSIDE' }),
    );
    expect(prisma.wFHRequest.findFirst).not.toHaveBeenCalled();
  });

  it('does not set WFH for an approved normal-team holiday weekday', async () => {
    jest.setSystemTime(new Date(2026, 8, 8, 9));
    const { service, prisma } = createService({
      teamName: null,
      holidayDates: ['2026-09-08'],
      approvedWfh: true,
    });

    await expect(service.punchIn(7, 1, 2)).resolves.toEqual(
      expect.objectContaining({ clockIn: expect.any(Date) }),
    );
    expect(prisma.attendanceRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clockIn: expect.any(Date) }),
    }));
    expect(prisma.wFHRequest.findFirst).not.toHaveBeenCalled();
  });

  it('sets WFH for approved Sales Saturday', async () => {
    jest.setSystemTime(new Date(2026, 8, 5, 9));
    const { service } = createService({ teamName: 'SALES', approvedWfh: true });

    await expect(service.punchIn(7, 1, 2)).resolves.toEqual(
      expect.objectContaining({ locationStatus: 'WFH' }),
    );
  });

  it('does not set WFH for approved Sales holiday Saturday', async () => {
    jest.setSystemTime(new Date(2026, 8, 5, 9));
    const { service, prisma } = createService({
      teamName: 'SALES',
      holidayDates: ['2026-09-05'],
      approvedWfh: true,
    });

    await expect(service.punchIn(7, 1, 2)).resolves.toEqual(
      expect.objectContaining({ clockIn: expect.any(Date) }),
    );
    expect(prisma.attendanceRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clockIn: expect.any(Date) }),
    }));
    expect(prisma.wFHRequest.findFirst).not.toHaveBeenCalled();
  });

  it('does not set WFH for approved Sales Sunday', async () => {
    jest.setSystemTime(new Date(2026, 8, 6, 9));
    const { service, prisma } = createService({ teamName: 'SALES', approvedWfh: true });

    await expect(service.punchIn(7, 1, 2)).resolves.toEqual(
      expect.objectContaining({ locationStatus: 'OUTSIDE' }),
    );
    expect(prisma.wFHRequest.findFirst).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'REJECTED'])('does not set WFH for %s WFH', async (status) => {
    jest.setSystemTime(new Date(2026, 8, 7, 9));
    const { service, prisma } = createService({ teamName: null, approvedWfh: false });

    await expect(service.punchIn(7, 1, 2)).resolves.toEqual(
      expect.objectContaining({ locationStatus: 'OUTSIDE' }),
    );
    expect(prisma.wFHRequest.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'APPROVED' }),
    });
  });

  it('passes the local business date to WorkingDaysService without UTC shifting', async () => {
    jest.setSystemTime(new Date(2026, 8, 7, 9));
    const { service, workingDaysService } = createService({ teamName: null, approvedWfh: true });
    const getWorkingDatesSpy = jest.spyOn(workingDaysService, 'getWorkingDates');

    await service.punchIn(7, 1, 2);

    expect(getWorkingDatesSpy).toHaveBeenCalledWith(7, [new Date(2026, 8, 7)]);
  });
});
