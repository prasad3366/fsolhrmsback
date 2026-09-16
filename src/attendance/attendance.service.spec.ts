import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { getBusinessDateKey } from './utils/business-date.util';

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

  it('allows FINANCE_MANAGER attendance access through the authorization service', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValue(true),
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    jest.spyOn(service, 'getEmployeeMonthlySummary').mockResolvedValue({ employeeId: 7 } as any);

    await expect(
      service.getTargetEmployeeAttendanceSummary({ id: 1, role: 'FINANCE_MANAGER', employeeId: 10 }, 7, '2026-09'),
    ).resolves.toEqual(expect.objectContaining({ employeeId: 7 }));

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(
      { id: 1, role: 'FINANCE_MANAGER', employeeId: 10 },
      7,
    );
  });
});

describe('AttendanceService employee scope', () => {
  const employeeFindMany = jest.fn();
  const teamFindMany = jest.fn();
  const authorizationService = {
    canAccessEmployee: jest.fn().mockResolvedValue(true),
  } as any;
  const prisma = {
    employee: { findMany: employeeFindMany },
    team: { findMany: teamFindMany },
  } as any;
  const holidayService = { isHoliday: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    employeeFindMany.mockResolvedValue([]);
    teamFindMany.mockResolvedValue([{ id: 2 }]);
    authorizationService.canAccessEmployee.mockResolvedValue(true);
  });

  it('scopes manager search by teamId and never designation', async () => {
    employeeFindMany.mockResolvedValue([{ id: 21, teamId: 2 }]);
    const service = new AttendanceService(prisma, holidayService, authorizationService);

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
    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(
      { employeeId: 11, role: 'SALES_MANAGER' },
      21,
    );
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s to search active employees organization-wide', async (role) => {
    const service = new AttendanceService(prisma, holidayService);

    await service.getAttendanceEmployees({ user: { employeeId: 1, role } }, '7');

    expect(teamFindMany).not.toHaveBeenCalled();
    expect(employeeFindMany.mock.calls[0][0].where.AND[0]).toEqual({ status: 'ACTIVE' });
  });

  it('scopes Finance attendance employees to managed Finance teams', async () => {
    employeeFindMany.mockResolvedValue([{ id: 31, teamId: 2 }]);
    const service = new AttendanceService(prisma, holidayService, authorizationService);
    await service.getAttendanceEmployees({ user: { employeeId: 1, role: 'FINANCE_MANAGER' } }, '7');

    expect(teamFindMany).toHaveBeenCalledWith({ where: { managerId: 1 }, select: { id: true } });
    expect(employeeFindMany.mock.calls[0][0].where.AND[0]).toEqual({
      teamId: { in: [2] },
    });
    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(
      { employeeId: 1, role: 'FINANCE_MANAGER' },
      31,
    );
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

  it('commits the canonical punch-in record and log together', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendanceRecordCreate = jest.fn().mockResolvedValue({ id: 2, clockIn: new Date() });
    const transaction = jest.fn(async (callback) => callback({
      attendanceLog: { create: attendanceLogCreate },
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: attendanceRecordCreate,
      },
      attendancePolicy,
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

    await expect(service.punchIn(7, 1, 2)).resolves.toEqual(
      expect.objectContaining({ id: 2, locationStatus: 'OUTSIDE' }),
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(attendanceLogCreate).toHaveBeenCalledWith({
      data: { employeeId: 7, type: 'IN', time: expect.any(Date) },
    });
    expect(attendanceRecordCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AttendanceStatus.IN_PROGRESS }),
    }));
  });

  it('rolls back the punch-in transaction when the canonical record fails', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendanceRecordCreate = jest.fn().mockRejectedValue(new Error('attendance write failed'));
    let committed = false;
    const transaction = jest.fn(async (callback) => {
      try {
        const result = await callback({
          attendanceLog: { create: attendanceLogCreate },
          attendanceRecord: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: attendanceRecordCreate,
          },
          attendancePolicy,
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
    expect(attendanceLogCreate).toHaveBeenCalledTimes(0);
    expect(committed).toBe(false);
  });

  it('maps a concurrent unique-constraint punch-in race to the intended duplicate-clock-in error', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendeeRecordCreate = jest.fn().mockRejectedValue({ code: 'P2002' });
    const transaction = jest.fn(async (callback) => callback({
      attendanceLog: { create: attendanceLogCreate },
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: attendeeRecordCreate,
      },
      attendancePolicy,
    }));
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

    await expect(service.punchIn(7, 1, 2)).rejects.toThrow(BadRequestException);
    await expect(service.punchIn(7, 1, 2)).rejects.toThrow('Already clocked in');
    expect(attendanceLogCreate).toHaveBeenCalledTimes(0);
  });

  it('commits the canonical punch-out update and log together', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendanceUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const attendanceFindUnique = jest.fn().mockResolvedValue({ id: 2, clockIn: new Date(Date.now() - 8 * 3600000), clockOut: new Date(), totalHours: 8, status: AttendanceStatus.PRESENT });
    const transaction = jest.fn(async (callback) => callback({
      attendanceLog: { create: attendanceLogCreate },
      attendanceRecord: {
        findUnique: attendanceFindUnique,
        updateMany: attendanceUpdateMany,
      },
      attendancePolicy,
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

    await expect(service.punchOut(7, 1, 2)).resolves.toEqual(expect.objectContaining({ id: 2, status: AttendanceStatus.PRESENT, totalHours: 8 }));

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(attendanceLogCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ employeeId: 7, type: 'OUT' }) }));
    expect(attendanceUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects punch-out when no canonical check-in exists', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const transaction = jest.fn(async (callback) => callback({
      attendanceLog: { create: attendanceLogCreate },
      attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null) },
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

    await expect(service.punchOut(7, 1, 2)).rejects.toThrow('No active check-in found');
    expect(attendanceLogCreate).not.toHaveBeenCalled();
  });

  it('rolls back the punch-out transaction when Attendance update fails', async () => {
    const attendanceLogCreate = jest.fn().mockResolvedValue({ id: 1 });
    const attendanceUpdateMany = jest.fn().mockRejectedValue(new Error('attendance update failed'));
    let committed = false;
    const transaction = jest.fn(async (callback) => {
      try {
        const result = await callback({
          attendanceLog: { create: attendanceLogCreate },
          attendanceRecord: {
            findUnique: jest.fn().mockResolvedValue({ id: 2, clockIn: new Date(Date.now() - 8 * 3600000), clockOut: null }),
            updateMany: attendanceUpdateMany,
          },
          attendancePolicy,
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
    expect(attendanceLogCreate).toHaveBeenCalledTimes(0);
    expect(committed).toBe(false);
  });

  it('preserves duplicate punch-in and punch-out errors without writing logs', async () => {
    const transaction = jest.fn(async (callback) => callback({
      attendanceRecord: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ clockIn: new Date(), clockOut: null })
          .mockResolvedValueOnce({ clockIn: new Date(), clockOut: new Date() }),
      },
      attendancePolicy: {
        upsert: jest.fn().mockResolvedValue({
          shiftStartTime: '09:00',
          shiftEndTime: '18:00',
          gracePeriodMins: 15,
          earlyCheckoutMins: 30,
          halfDayHours: 4,
        }),
      },
    }));
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          userId: 70,
          status: 'ACTIVE',
          user: { email: 'test@example.com' },
        }),
      },
      attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      attendancePolicy,
      $transaction: transaction,
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    await expect(service.punchIn(7)).rejects.toThrow(BadRequestException);
    await expect(service.punchOut(7)).rejects.toThrow(BadRequestException);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects a second sequential checkout after the first successful one', async () => {
    const clockIn = new Date('2026-09-10T09:00:00.000Z');
    const firstClockOut = new Date('2026-09-10T17:00:00.000Z');
    let closeAttempts = 0;
    const attendanceRecord = {
      findUnique: jest.fn().mockImplementation(async () => {
        if (closeAttempts === 0) {
          return { id: 9, userId: 70, date: new Date(2026, 8, 10), clockIn, clockOut: null };
        }
        return { id: 9, userId: 70, date: new Date(2026, 8, 10), clockIn, clockOut: firstClockOut, totalHours: 8, status: AttendanceStatus.PRESENT };
      }),
      updateMany: jest.fn().mockImplementation(async () => {
        closeAttempts += 1;
        return closeAttempts === 1 ? { count: 1 } : { count: 0 };
      }),
      update: jest.fn().mockResolvedValue({ id: 9, clockOut: firstClockOut, totalHours: 8, status: AttendanceStatus.PRESENT }),
    };
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70, status: 'ACTIVE', user: { email: 'test@example.com' } }) },
      attendanceRecord,
      attendancePolicy: { upsert: jest.fn().mockResolvedValue({ shiftStartTime: '09:00', shiftEndTime: '18:00', gracePeriodMins: 15, earlyCheckoutMins: 30, halfDayHours: 4 }) },
      attendanceLog: { create: jest.fn() },
      $transaction: jest.fn(async (callback) => callback({
        attendanceRecord,
        attendancePolicy: { upsert: jest.fn().mockResolvedValue({ shiftStartTime: '09:00', shiftEndTime: '18:00', gracePeriodMins: 15, earlyCheckoutMins: 30, halfDayHours: 4 }) },
        attendanceLog: { create: jest.fn() },
      })),
    } as any;
    const service = new AttendanceService(prisma, holidayService, authorizationService);

    jest.useFakeTimers().setSystemTime(firstClockOut);
    try {
      await expect(service.clockOut(70)).resolves.toEqual(expect.objectContaining({ clockOut: firstClockOut, totalHours: 8, status: AttendanceStatus.PRESENT }));
      await expect(service.clockOut(70)).rejects.toThrow(BadRequestException);
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows exactly one concurrent checkout to win and creates only one OUT log', async () => {
    const clockIn = new Date('2026-09-10T09:00:00.000Z');
    const successfulOut = new Date('2026-09-10T17:00:00.000Z');
    const row = {
      id: 12,
      userId: 70,
      date: new Date(2026, 8, 10),
      clockIn,
      clockOut: null,
      totalHours: null,
      status: AttendanceStatus.IN_PROGRESS,
    };

    let transactionCall = 0;
    const transaction = jest.fn(async (callback) => {
      transactionCall += 1;
      const isWinningCall = transactionCall === 1;
      return callback({
        attendanceRecord: {
          findUnique: jest.fn().mockResolvedValue(isWinningCall ? { ...row, clockOut: successfulOut, totalHours: 8, status: AttendanceStatus.PRESENT } : row),
          updateMany: jest.fn().mockResolvedValue({ count: isWinningCall ? 1 : 0 }),
        },
        attendancePolicy: { upsert: jest.fn().mockResolvedValue({ shiftStartTime: '09:00', shiftEndTime: '18:00', gracePeriodMins: 15, earlyCheckoutMins: 30, halfDayHours: 4 }) },
        attendanceLog: { create: jest.fn().mockResolvedValue({ id: isWinningCall ? 1 : 0, type: 'OUT', time: successfulOut }) },
      });
    });

    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70, status: 'ACTIVE', user: { email: 'test@example.com' } }) },
      attendanceRecord: { findUnique: jest.fn().mockResolvedValue(row), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      attendancePolicy: { upsert: jest.fn().mockResolvedValue({ shiftStartTime: '09:00', shiftEndTime: '18:00', gracePeriodMins: 15, earlyCheckoutMins: 30, halfDayHours: 4 }) },
      attendanceLog: { create: jest.fn() },
      $transaction: transaction,
    } as any;

    const service = new AttendanceService(prisma, holidayService, authorizationService);

    jest.useFakeTimers().setSystemTime(successfulOut);
    try {
      const result = await Promise.allSettled([
        service.clockOut(70),
        service.clockOut(70),
      ]);
      const fulfilled = result.filter((item) => item.status === 'fulfilled');
      const rejected = result.filter((item) => item.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((fulfilled[0] as PromiseFulfilledResult<any>).value).toEqual(expect.objectContaining({ totalHours: 8, status: AttendanceStatus.PRESENT }));
    } finally {
      jest.useRealTimers();
    }
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
    [4 + 1 / 60, AttendanceStatus.HALF_DAY],
    [4, AttendanceStatus.HALF_DAY],
    [6 + 59 / 60, AttendanceStatus.HALF_DAY],
    [7, AttendanceStatus.PRESENT],
    [8, AttendanceStatus.PRESENT],
  ])('calculates persisted checkout status at %s hours', async (hours, status) => {
    const clockOut = new Date('2026-09-09T17:00:00.000Z');
    const attendanceRecordUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const attendanceRecordFindUnique = jest.fn().mockResolvedValue({
      id: 1,
      clockIn: new Date(clockOut.getTime() - hours * 3600000),
      clockOut,
      totalHours: hours,
      status,
      isLate: false,
    });
    const service = new AttendanceService({} as any, {} as any);
    const client = {
      attendanceRecord: {
        findUnique: attendanceRecordFindUnique,
        updateMany: attendanceRecordUpdateMany,
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

    expect(attendanceRecordUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: 70,
        date: expect.any(Date),
        clockIn: { gte: new Date(0) },
        clockOut: null,
      },
      data: expect.objectContaining({
        clockOut,
        totalHours: expect.closeTo(hours, 8),
        status,
      }),
    });
  });

  it.each([AttendanceStatus.PRESENT, AttendanceStatus.LATE])(
    'interprets an open record stored as %s as IN_PROGRESS in history',
    async (storedStatus) => {
      const date = new Date(2026, 8, 9);
      const prisma = {
        attendanceRecord: {
          findMany: jest.fn().mockResolvedValue([{
            date,
            clockIn: new Date(date.getTime() + 9 * 3600000),
            clockOut: null,
            status: storedStatus,
          }]),
        },
      } as any;
      const service = new AttendanceService(prisma, {} as any);

      await expect(service.getAttendanceHistory(70)).resolves.toEqual([
        expect.objectContaining({ date, status: AttendanceStatus.IN_PROGRESS }),
      ]);
    },
  );

  it('classifies completed reads from clockIn and clockOut instead of stored status', async () => {
    const clockIn = new Date('2026-09-09T09:00:00.000Z');
    const clockOut = new Date('2026-09-09T17:00:00.000Z');
    const prisma = {
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([{
          date: clockIn,
          clockIn,
          clockOut,
          status: AttendanceStatus.ABSENT,
        }]),
      },
    } as any;
    const service = new AttendanceService(prisma, {} as any);

    await expect(service.getAttendanceHistory(70)).resolves.toEqual([
      expect.objectContaining({ status: AttendanceStatus.PRESENT }),
    ]);
  });

  it('resolves today status from the authenticated employee identity', async () => {
    const employeeFindUnique = jest.fn().mockResolvedValue({ id: 7, userId: 70 });
    const attendanceFindUnique = jest.fn().mockResolvedValue(null);
    const service = new AttendanceService({
      employee: { findUnique: employeeFindUnique },
      attendanceRecord: { findUnique: attendanceFindUnique },
    } as any, {} as any);

    await expect(service.getTodayStatusForEmployee(7)).resolves.toEqual({
      hasPunchedIn: false,
      hasPunchedOut: false,
      punchInTime: null,
      punchOutTime: null,
      clockIn: null,
      clockOut: null,
      locationStatus: null,
      totalHours: null,
      status: null,
      state: 'NOT_CHECKED_IN',
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

  it('returns the complete current-month result on one page with metadata', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 30, 12));
    const presentDate = new Date(2026, 8, 29);
    const olderDate = new Date(2026, 8, 3);
    const prisma = {
      employee: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          where.userId === 70
            ? { id: 7, userId: 70 }
            : { id: 7, userId: 70 },
        ),
      },
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
      await expect(service.getAttendanceHistory(70, 9, 2026, undefined, 1, 10)).resolves.toEqual({
        data: [
          expect.objectContaining({ date: presentDate }),
          expect.objectContaining({ date: olderDate }),
        ],
        meta: { page: 1, pageSize: 2, total: 2, totalPages: 1, month: 9, year: 2026 },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('merges virtual absences before returning the complete single page', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 3, 12));
    const presentDate = new Date(Date.UTC(2026, 8, 2, 12));
    const absentDate = new Date(Date.UTC(2026, 8, 1, 12));
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
      const result = await service.getAttendanceHistory(70, 9, 2026, undefined, 1, 10);
      expect(result).toEqual(expect.objectContaining({
        meta: { page: 1, pageSize: 2, total: 2, totalPages: 1, month: 9, year: 2026 },
      }));
      expect((result as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          date: presentDate,
          status: AttendanceStatus.PRESENT,
        }),
        expect.objectContaining({
        date: absentDate,
        clockIn: null,
        clockOut: null,
        status: AttendanceStatus.ABSENT,
        }),
      ]));
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps inactive employee attendance history readable', async () => {
    const attendance = [{ id: 1, employeeId: 7, date: new Date('2026-08-01'), status: undefined, locationLabel: 'Unknown' }];
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
        where: { userId: 70 },
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
      where: { userId: 70 },
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
      where: { userId: 70 },
      orderBy: { date: 'asc' },
    });
  });

  it('returns virtual absences for missing working-day records', async () => {
    const presentDate = new Date(Date.UTC(2026, 8, 1, 12));
    const absentDate = new Date(Date.UTC(2026, 8, 2, 12));
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

      expect(records.every((record) => record.date <= new Date(Date.UTC(2026, 8, 7, 23, 59, 59, 999)))).toBe(true);
      expect(workingDaysService.getWorkingDates).toHaveBeenCalledWith(
        7,
        expect.arrayContaining([new Date(Date.UTC(2026, 8, 7, 12))]),
      );
      expect(workingDaysService.getWorkingDates.mock.calls[0][1]).not.toContainEqual(
        new Date(Date.UTC(2026, 8, 8)),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('excludes adjacent and future records while returning all current-month records on page one', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T12:00:00.000Z'));
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            userId: 70,
            date: new Date('2026-08-31T00:00:00.000Z'),
            clockIn: new Date('2026-08-31T04:00:00.000Z'),
            clockOut: new Date('2026-08-31T12:00:00.000Z'),
            status: AttendanceStatus.PRESENT,
          },
          {
            id: 2,
            userId: 70,
            date: new Date('2026-09-06T00:00:00.000Z'),
            clockIn: new Date('2026-09-06T04:00:00.000Z'),
            clockOut: new Date('2026-09-06T12:00:00.000Z'),
            status: AttendanceStatus.PRESENT,
          },
          {
            id: 3,
            userId: 70,
            date: new Date('2026-09-08T00:00:00.000Z'),
            clockIn: new Date('2026-09-08T04:00:00.000Z'),
            clockOut: new Date('2026-09-08T12:00:00.000Z'),
            status: AttendanceStatus.PRESENT,
          },
        ]),
      },
    } as any;
    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue([]),
    } as any;
    const service = new AttendanceService(prisma, {} as any, undefined as any, workingDaysService);

    try {
      const result = await service.getAttendanceHistory(70, 9, 2026, undefined, 1, 10) as any;

      expect(result).toEqual(expect.objectContaining({
        data: [expect.objectContaining({ id: 2 })],
        meta: { page: 1, pageSize: 1, total: 1, totalPages: 1, month: 9, year: 2026 },
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns an empty past month as page one of one', async () => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const workingDaysService = { getWorkingDates: jest.fn().mockResolvedValue([]) } as any;
    const service = new AttendanceService(prisma, {} as any, undefined as any, workingDaysService);

    await expect(service.getAttendanceHistory(70, 7, 2026, undefined, 1, 10)).resolves.toEqual({
      data: [],
      meta: { page: 1, pageSize: 1, total: 0, totalPages: 1, month: 7, year: 2026 },
    });
  });

  it('returns the real current-day record with open and completed timestamps preserved', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
    const clockIn = new Date('2026-09-11T07:28:00.000Z');
    const clockOut = new Date('2026-09-11T12:30:00.000Z');
    const realRecord = {
      userId: 70,
      date: new Date(2026, 8, 11),
      clockIn,
      clockOut: null,
      totalHours: null,
      status: AttendanceStatus.IN_PROGRESS,
    };
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([realRecord]) },
      leave: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue([new Date(2026, 8, 11)]),
    } as any;
    const service = new AttendanceService(prisma, {} as any, undefined as any, workingDaysService);

    try {
      const openRecords = await service.getAttendanceHistory(70, 9, 2026) as any[];
      expect(openRecords).toEqual([
        expect.objectContaining({
          date: realRecord.date,
          clockIn,
          clockOut: null,
          totalHours: null,
          status: AttendanceStatus.IN_PROGRESS,
        }),
      ]);

      prisma.attendanceRecord.findMany.mockResolvedValue([{ ...realRecord, clockOut, totalHours: 5 }]);
      const completedRecords = await service.getAttendanceHistory(70, 9, 2026) as any[];
      expect(completedRecords).toEqual([
        expect.objectContaining({
          date: realRecord.date,
          clockIn,
          clockOut,
          totalHours: 5,
          status: AttendanceStatus.HALF_DAY,
        }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('matches a UTC-midnight persisted date to the same Asia/Kolkata virtual business date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
    const realRecord = {
      id: 21,
      userId: 70,
      date: new Date('2026-09-10T00:00:00.000Z'),
      clockIn: new Date('2026-09-11T08:38:10.299Z'),
      clockOut: null,
      totalHours: null,
      status: AttendanceStatus.IN_PROGRESS,
      isLate: true,
    };
    const virtualBusinessDate = new Date('2026-09-10T18:30:00.000Z');
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([realRecord]) },
      leave: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue([virtualBusinessDate]),
    } as any;
    const service = new AttendanceService(prisma, {} as any, undefined as any, workingDaysService);

    try {
      const result = await service.getAttendanceHistory(70, 9, 2026) as any[];

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        id: 21,
        date: realRecord.date,
        clockIn: realRecord.clockIn,
        clockOut: null,
        totalHours: null,
        status: AttendanceStatus.IN_PROGRESS,
        isLate: true,
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('preserves real completed ABSENT fields while keeping virtual ABSENT and real LEAVE behavior', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
    const realAbsent = {
      id: 22,
      userId: 70,
      date: new Date('2026-09-11T00:00:00.000Z'),
      clockIn: new Date('2026-09-11T08:57:46.091Z'),
      clockOut: new Date('2026-09-11T08:58:11.508Z'),
      totalHours: 0.007,
      status: AttendanceStatus.PRESENT,
      isLate: true,
      isEarlyCheckout: true,
    };
    const workingDate = new Date('2026-09-11T00:00:00.000Z');
    const createService = (record: any, leave: any[] = []) => {
      const prisma = {
        employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70 }) },
        attendanceRecord: { findMany: jest.fn().mockResolvedValue(record ? [record] : []) },
        leave: { findMany: jest.fn().mockResolvedValue(leave) },
      } as any;
      const workingDaysService = { getWorkingDates: jest.fn().mockResolvedValue([workingDate]) } as any;
      return new AttendanceService(prisma, {} as any, undefined as any, workingDaysService);
    };

    try {
      const absentResult = await createService(realAbsent).getAttendanceHistory(70, 9, 2026) as any[];
      expect(absentResult).toEqual([
        expect.objectContaining({
          id: 22,
          clockIn: realAbsent.clockIn,
          clockOut: realAbsent.clockOut,
          totalHours: realAbsent.totalHours,
          status: AttendanceStatus.ABSENT,
          isLate: true,
          isEarlyCheckout: true,
        }),
      ]);

      const virtualResult = await createService(null).getAttendanceHistory(70, 9, 2026) as any[];
      expect(virtualResult).toEqual([
        expect.objectContaining({
          clockIn: null,
          clockOut: null,
          totalHours: 0,
          status: AttendanceStatus.ABSENT,
        }),
      ]);

      const leaveResult = await createService(realAbsent, [{
        status: 'APPROVED',
        startDate: workingDate,
        endDate: workingDate,
      }]).getAttendanceHistory(70, 9, 2026) as any[];
      expect(leaveResult).toEqual([
        expect.objectContaining({
          id: 22,
          clockIn: realAbsent.clockIn,
          clockOut: realAbsent.clockOut,
          totalHours: realAbsent.totalHours,
          status: AttendanceStatus.LEAVE,
        }),
      ]);
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
      { date: new Date(2026, 7, 3), clockIn: new Date(2026, 7, 3, 9), clockOut: new Date(2026, 7, 3, 17), status: 'PRESENT' },
      { date: new Date(2026, 7, 4), clockIn: new Date(2026, 7, 4, 9), clockOut: new Date(2026, 7, 4, 13), status: 'HALF_DAY' },
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

  it('counts multiple persisted attended records, including late attendance, as present', async () => {
    const workingDates = [
      new Date(2026, 7, 3),
      new Date(2026, 7, 4),
      new Date(2026, 7, 5),
    ];
    const { service, prisma } = createService(workingDates);
    prisma.attendanceRecord.findMany.mockResolvedValue([
      { date: new Date(2026, 7, 3), clockIn: new Date(2026, 7, 3, 9), clockOut: new Date(2026, 7, 3, 17), status: AttendanceStatus.PRESENT },
      { date: new Date(2026, 7, 4), clockIn: new Date(2026, 7, 4, 9), clockOut: new Date(2026, 7, 4, 17), status: AttendanceStatus.PRESENT },
      { date: new Date(2026, 7, 5), clockIn: new Date(2026, 7, 5, 9), clockOut: new Date(2026, 7, 5, 17), status: AttendanceStatus.LATE },
    ]);
    prisma.leave.findMany.mockResolvedValue([]);

    const result = await service.getEmployeeMonthlySummary(7, '2026-08');

    expect(result.presentDays).toBe(3);
    expect(result.absentDays).toBe(0);
    expect(result.attendancePercentage).toBe(100);
    expect(result.workingDays).toBe(
      result.presentDays + result.halfDays + result.absentDays + result.leaveDays,
    );
  });

  it('counts historical records by clock-in business date and treats open records as absent', async () => {
    const workingDates = [
      new Date(Date.UTC(2026, 7, 3)),
      new Date(Date.UTC(2026, 7, 4)),
      new Date(Date.UTC(2026, 7, 5)),
      new Date(Date.UTC(2026, 7, 6)),
    ];
    const { service, prisma } = createService(workingDates);
    prisma.attendanceRecord.findMany.mockResolvedValue([
      {
        date: new Date('2026-08-02T00:00:00.000Z'),
        clockIn: new Date('2026-08-03T04:00:00.000Z'),
        clockOut: new Date('2026-08-03T12:00:00.000Z'),
        status: AttendanceStatus.PRESENT,
      },
      {
        date: new Date('2026-08-04T00:00:00.000Z'),
        clockIn: new Date('2026-08-04T04:00:00.000Z'),
        clockOut: new Date('2026-08-04T08:30:00.000Z'),
        status: AttendanceStatus.PRESENT,
      },
      {
        date: new Date('2026-08-05T00:00:00.000Z'),
        clockIn: new Date('2026-08-05T04:00:00.000Z'),
        status: AttendanceStatus.PRESENT,
      },
    ]);
    prisma.leave.findMany.mockResolvedValue([]);

    const result = await service.getEmployeeMonthlySummary(7, '2026-08');

    expect(result).toEqual(expect.objectContaining({
      workingDays: 4,
      presentDays: 1,
      halfDays: 1,
      absentDays: 2,
      leaveDays: 0,
    }));
    expect(result.workingDays).toBe(
      result.presentDays + result.halfDays + result.absentDays + result.leaveDays,
    );
  });

  it('keeps summary counts aligned with monthly details classification', async () => {
    const workingDates = [
      new Date(Date.UTC(2026, 7, 3)),
      new Date(Date.UTC(2026, 7, 4)),
      new Date(Date.UTC(2026, 7, 5)),
      new Date(Date.UTC(2026, 7, 6)),
      new Date(Date.UTC(2026, 7, 7)),
    ];
    const { service, prisma } = createService(workingDates);
    prisma.attendanceRecord.findMany.mockResolvedValue([
      {
        date: workingDates[0],
        clockIn: new Date('2026-08-03T04:00:00.000Z'),
        clockOut: new Date('2026-08-03T12:00:00.000Z'),
        status: AttendanceStatus.PRESENT,
      },
      {
        date: workingDates[1],
        clockIn: new Date('2026-08-04T04:00:00.000Z'),
        clockOut: new Date('2026-08-04T08:30:00.000Z'),
        status: AttendanceStatus.PRESENT,
      },
      {
        date: workingDates[2],
        clockIn: new Date('2026-08-05T04:00:00.000Z'),
        status: AttendanceStatus.IN_PROGRESS,
      },
    ]);
    prisma.leave.findMany.mockResolvedValue([
      { status: 'APPROVED', startDate: workingDates[3], endDate: workingDates[3] },
    ]);

    const details = await service.getAttendanceHistory(70, 8, 2026) as any[];
    const summary = await service.getEmployeeMonthlySummary(7, '2026-08');

    expect(details.map((record) => record.status)).toEqual([
      AttendanceStatus.PRESENT,
      AttendanceStatus.HALF_DAY,
      AttendanceStatus.IN_PROGRESS,
      AttendanceStatus.LEAVE,
      AttendanceStatus.ABSENT,
    ]);
    expect(summary).toEqual(expect.objectContaining({
      workingDays: 5,
      presentDays: 1,
      halfDays: 1,
      leaveDays: 1,
      absentDays: 2,
    }));
    expect(summary.workingDays).toBe(
      summary.presentDays + summary.halfDays + summary.absentDays + summary.leaveDays,
    );
  });

  it('calculates independent summaries for normal and Sales employees', async () => {
    const normalWorkingDates = [
      new Date(Date.UTC(2026, 7, 3)),
      new Date(Date.UTC(2026, 7, 4)),
    ];
    const salesWorkingDates = [
      new Date(Date.UTC(2026, 7, 7)),
      new Date(Date.UTC(2026, 7, 8)),
      new Date(Date.UTC(2026, 7, 9)),
    ];
    const prisma = {
      employee: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          where.id === 7 || where.userId === 70
            ? { id: 7, userId: 70, team: null }
            : { id: 8, userId: 80, team: { name: 'SALES' } }),
      },
      attendanceRecord: {
        findMany: jest.fn().mockImplementation(({ where }: any) => where.userId === 70
          ? [{
              date: new Date('2026-08-02T00:00:00.000Z'),
              clockIn: new Date('2026-08-03T04:00:00.000Z'),
              clockOut: new Date('2026-08-03T12:00:00.000Z'),
              status: AttendanceStatus.PRESENT,
            }]
          : [{
              date: new Date('2026-08-08T00:00:00.000Z'),
              clockIn: new Date('2026-08-08T04:00:00.000Z'),
              clockOut: new Date('2026-08-08T08:30:00.000Z'),
              status: AttendanceStatus.PRESENT,
            }, {
              date: new Date('2026-08-09T00:00:00.000Z'),
              clockIn: new Date('2026-08-09T04:00:00.000Z'),
              status: AttendanceStatus.PRESENT,
            }]),
      },
      leave: {
        findMany: jest.fn().mockImplementation(({ where }: any) => where.employeeId === 7
          ? [{ status: 'APPROVED', startDate: normalWorkingDates[1], endDate: normalWorkingDates[1] }]
          : []),
      },
    } as any;
    const workingDaysService = {
      getWorkingDates: jest.fn().mockImplementation((employeeId: number) => (
        employeeId === 7 ? normalWorkingDates : salesWorkingDates
      )),
    } as any;
    const service = new AttendanceService(prisma, {} as any, undefined as any, workingDaysService);

    const [normalSummary, salesSummary] = await Promise.all([
      service.getEmployeeMonthlySummary(7, '2026-08'),
      service.getEmployeeMonthlySummary(8, '2026-08'),
    ]);

    expect(normalSummary).toEqual(expect.objectContaining({
      employeeId: 7,
      workingDays: 2,
      presentDays: 1,
      leaveDays: 1,
      absentDays: 0,
    }));
    expect(salesSummary).toEqual(expect.objectContaining({
      employeeId: 8,
      workingDays: 3,
      presentDays: 0,
      halfDays: 1,
      absentDays: 2,
      leaveDays: 0,
    }));
    expect(normalSummary.workingDays).toBe(
      normalSummary.presentDays + normalSummary.halfDays + normalSummary.absentDays + normalSummary.leaveDays,
    );
    expect(salesSummary.workingDays).toBe(
      salesSummary.presentDays + salesSummary.halfDays + salesSummary.absentDays + salesSummary.leaveDays,
    );
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
    const salesSaturday = new Date(Date.UTC(2026, 7, 1));
    const holidayService = {
      isHoliday: jest.fn(async (date: Date) =>
        getBusinessDateKey(date) === getBusinessDateKey(salesSaturday) ? { date } : null,
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
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

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

    expect(getWorkingDatesSpy).toHaveBeenCalledWith(7, [new Date(Date.UTC(2026, 8, 7))]);
  });

  it.each([
    ['OFFICE', 'OFFICE', 'In Office'],
    ['OFFICE', 'OUTSIDE', 'Checked Out Outside Office'],
    ['OUTSIDE', 'OFFICE', 'Checked In Outside Office'],
    ['OUTSIDE', 'OUTSIDE', 'Out of Office'],
  ])('returns %s + %s as %s in Employee Attendance history', async (punchInLocationStatus, punchOutLocationStatus, locationLabel) => {
    const { service, prisma } = createService({ teamName: null });
    prisma.attendanceRecord.findMany.mockResolvedValueOnce([{
      id: 1,
      userId: 70,
      date: new Date(2026, 8, 7),
      clockIn: new Date(2026, 8, 7, 9),
      clockOut: new Date(2026, 8, 7, 17),
      status: AttendanceStatus.PRESENT,
      punchInLocationStatus,
      punchOutLocationStatus,
    }]);

    await expect(service.getAttendanceHistory(70)).resolves.toEqual([
      expect.objectContaining({ locationLabel }),
    ]);
  });
});
