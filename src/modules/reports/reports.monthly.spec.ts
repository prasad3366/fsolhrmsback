import { ForbiddenException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { ReportsService } from './reports.service';

const employee = (id: number, userId: number, teamName = 'Engineering') => ({
  id,
  userId,
  empCode: `E${id}`,
  firstName: `Employee${id}`,
  lastName: 'Test',
  department: 'Engineering',
  team: { id: teamName === 'SALES' ? 2 : 1, name: teamName },
});

describe('ReportsService monthly attendance report', () => {
  const employeeFindMany = jest.fn();
  const employeeCount = jest.fn();
  const attendanceFindMany = jest.fn();
  const leaveFindMany = jest.fn();
  const teamFindMany = jest.fn();
  const authorizationService = {
    canAccessOrganizationWide: jest.fn(),
    canAccessTeam: jest.fn(),
  };
  const prisma = {
    employee: { findMany: employeeFindMany, count: employeeCount },
    attendanceRecord: { findMany: attendanceFindMany },
    leave: { findMany: leaveFindMany },
    team: { findMany: teamFindMany },
  } as any;
  const attendanceHistory = jest.fn();

  const makeService = () => new ReportsService(
    prisma,
    authorizationService as any,
    { getWorkingDates: jest.fn() } as any,
    { getAttendanceHistory: attendanceHistory } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    employeeCount.mockResolvedValue(0);
    attendanceHistory.mockResolvedValue([]);
    authorizationService.canAccessOrganizationWide.mockReturnValue(true);
    authorizationService.canAccessTeam.mockResolvedValue(true);
    teamFindMany.mockResolvedValue([]);
    attendanceFindMany.mockResolvedValue([]);
    leaveFindMany.mockResolvedValue([]);
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s organization-wide monthly reports', async (role) => {
    employeeFindMany.mockResolvedValue([employee(1, 10)]);
    employeeCount.mockResolvedValue(1);
    const service = makeService();

    await expect(service.getMonthlyAttendanceReport({ id: 1, role }, { month: '2026-08' } as any)).resolves.toMatchObject({
      meta: { month: '2026-08', page: 1, pageSize: 25, total: 1, totalPages: 1 },
      summary: { totalEmployees: 1 },
    });
    expect(attendanceHistory).toHaveBeenCalledWith(10, 8, 2026);
  });

  it('denies Finance and Employee monthly Reports access', async () => {
    const service = makeService();

    await expect(service.getMonthlyAttendanceReport({ id: 2, role: 'FINANCE_MANAGER' }, { month: '2026-08' } as any)).rejects.toThrow(ForbiddenException);
    await expect(service.getMonthlyAttendanceReport({ id: 3, role: 'EMPLOYEE', employeeId: 3 }, { month: '2026-08' } as any)).rejects.toThrow(ForbiddenException);
  });

  it('restricts manager team filters inside the authenticated managed-team scope', async () => {
    authorizationService.canAccessOrganizationWide.mockReturnValue(false);
    teamFindMany.mockResolvedValue([{ id: 7 }]);
    employeeFindMany.mockResolvedValue([employee(1, 10)]);
    const service = makeService();

    await service.getMonthlyAttendanceReport(
      { id: 4, role: 'IT_MANAGER', employeeId: 10 },
      { month: '2026-08', teamId: 999, employeeId: 999 } as any,
    );

    const employeeQuery = employeeFindMany.mock.calls[employeeFindMany.mock.calls.length - 1][0];
    expect(employeeQuery.where.AND).toEqual(expect.arrayContaining([
      { teamId: { in: [7] } },
      { teamId: 999 },
      { id: 999 },
    ]));
    expect(teamFindMany).toHaveBeenCalledWith({ where: { managerId: 10 }, select: { id: true } });
  });

  it('uses canonical monthly history for approved leave and late/half-day statuses', async () => {
    employeeFindMany.mockResolvedValue([employee(1, 10)]);
    employeeCount.mockResolvedValue(1);
    attendanceHistory.mockResolvedValue([
      { userId: 10, date: new Date(2026, 7, 3), status: AttendanceStatus.LEAVE, clockIn: null, clockOut: null },
      { userId: 10, date: new Date(2026, 7, 4), status: AttendanceStatus.LATE, clockIn: new Date(2026, 7, 4, 9, 10), clockOut: new Date(2026, 7, 4, 16, 0) },
      { userId: 10, date: new Date(2026, 7, 5), status: AttendanceStatus.HALF_DAY, clockIn: new Date(2026, 7, 5, 9, 0), clockOut: new Date(2026, 7, 5, 13, 0) },
    ]);
    const service = makeService();

    const result = await service.getMonthlyAttendanceReport({ id: 1, role: 'HR' }, { month: '2026-08' } as any);

    expect(result.data[0]).toMatchObject({
      workingDays: 3,
      presentDays: 1,
      halfDays: 1,
      absentDays: 0,
      approvedLeaveDays: 1,
      presentEquivalentDays: 1.5,
    });
    expect(result.summary).toMatchObject({
      totalEmployees: 1,
      totalWorkingDays: 3,
      totalPresentDays: 1,
      totalHalfDays: 1,
      totalAbsentDays: 0,
      totalApprovedLeaveDays: 1,
      totalPresentEquivalentDays: 1.5,
    });
  });

  it.each(['PENDING', 'REJECTED', 'CANCELLED'])('does not treat %s leave as canonical LEAVE in monthly attendance', async (status) => {
    employeeFindMany.mockResolvedValue([employee(1, 10)]);
    employeeCount.mockResolvedValue(1);
    attendanceHistory.mockResolvedValue([
      { userId: 10, date: new Date(2026, 7, 3), status: AttendanceStatus.ABSENT, clockIn: null, clockOut: null },
    ]);
    const service = makeService();

    const result = await service.getMonthlyAttendanceReport({ id: 1, role: 'HR' }, { month: '2026-08' } as any);

    expect(result.data[0]).toMatchObject({
      approvedLeaveDays: 0,
      absentDays: 1,
      workingDays: 1,
    });
    expect(result.summary.totalApprovedLeaveDays).toBe(0);
  });

  it('counts canonical status totals across the monthly result set', async () => {
    const rows = [employee(1, 10), employee(2, 20)];
    employeeCount.mockResolvedValue(2);
    employeeFindMany.mockImplementation((args: any) =>
      args.take ? rows.slice(args.skip ?? 0, (args.skip ?? 0) + args.take) : rows,
    );
    attendanceHistory.mockImplementation(async (userId: number) => {
      if (userId === 10) {
        return [
          { userId: 10, date: new Date(2026, 7, 3), status: AttendanceStatus.PRESENT, clockIn: new Date(2026, 7, 3, 9, 0), clockOut: new Date(2026, 7, 3, 17, 0) },
          { userId: 10, date: new Date(2026, 7, 4), status: AttendanceStatus.LATE, clockIn: new Date(2026, 7, 4, 9, 30), clockOut: new Date(2026, 7, 4, 14, 0) },
          { userId: 10, date: new Date(2026, 7, 5), status: AttendanceStatus.HALF_DAY, clockIn: new Date(2026, 7, 5, 9, 0), clockOut: new Date(2026, 7, 5, 13, 0) },
        ];
      }
      return [
        { userId: 20, date: new Date(2026, 7, 4), status: AttendanceStatus.LEAVE, clockIn: null, clockOut: null },
      ];
    });
    const service = makeService();

    const result = await service.getMonthlyAttendanceReport({ id: 1, role: 'HR' }, { month: '2026-08', page: 1, pageSize: 1 } as any);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      employeeId: 1,
      workingDays: 3,
      presentDays: 2,
      halfDays: 1,
      absentDays: 0,
      approvedLeaveDays: 0,
      presentEquivalentDays: 2.5,
    });
    expect(result.summary).toMatchObject({
      totalEmployees: 2,
      totalWorkingDays: 4,
      totalPresentDays: 2,
      totalHalfDays: 1,
      totalAbsentDays: 0,
      totalApprovedLeaveDays: 1,
      totalPresentEquivalentDays: 2.5,
    });
    expect(result.meta).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
  });

  it('applies the status filter using canonical monthly status values', async () => {
    employeeFindMany.mockResolvedValue([employee(1, 10), employee(2, 20)]);
    employeeCount.mockResolvedValue(2);
    attendanceHistory.mockImplementation(async (userId: number) => {
      if (userId === 10) {
        return [{ userId: 10, date: new Date(2026, 7, 3), status: AttendanceStatus.PRESENT, clockIn: new Date(2026, 7, 3, 9), clockOut: new Date(2026, 7, 3, 17) }];
      }
      return [{ userId: 20, date: new Date(2026, 7, 4), status: AttendanceStatus.ABSENT, clockIn: null, clockOut: null }];
    });
    const service = makeService();

    const result = await service.getMonthlyAttendanceReport({ id: 1, role: 'HR' }, { month: '2026-08', status: AttendanceStatus.PRESENT } as any);

    expect(result.data.map((row) => row.employeeId)).toEqual([1]);
    expect(result.summary.totalEmployees).toBe(1);
  });

  it.each([
    ['2026-01', 1, 2026],
    ['2025-12', 12, 2025],
  ])('calls AttendanceService with the canonical month/year for %s', async (month, expectedMonth, expectedYear) => {
    employeeFindMany.mockResolvedValue([employee(1, 10)]);
    const service = makeService();

    await service.getMonthlyAttendanceReport({ id: 1, role: 'HR' }, { month } as any);

    expect(attendanceHistory).toHaveBeenCalledWith(10, expectedMonth, expectedYear);
  });

  it('uses the canonical current-month report period without raw date query assertions', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 10, 12));
    try {
      employeeFindMany.mockResolvedValue([employee(1, 10)]);
      const service = makeService();

      await service.getMonthlyAttendanceReport({ id: 1, role: 'HR' }, { month: '2026-09' } as any);

      expect(attendanceHistory).toHaveBeenCalledWith(10, 9, 2026);
    } finally {
      jest.useRealTimers();
    }
  });
});
