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
  const workingDates = jest.fn();
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

  beforeEach(() => {
    jest.clearAllMocks();
    employeeCount.mockResolvedValue(0);
    authorizationService.canAccessOrganizationWide.mockReturnValue(true);
    authorizationService.canAccessTeam.mockResolvedValue(true);
    teamFindMany.mockResolvedValue([]);
    attendanceFindMany.mockResolvedValue([]);
    leaveFindMany.mockResolvedValue([]);
    workingDates.mockResolvedValue([
      new Date(2026, 7, 3),
      new Date(2026, 7, 4),
      new Date(2026, 7, 5),
    ]);
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s organization-wide monthly reports', async (role) => {
    employeeFindMany.mockResolvedValue([employee(1, 10)]);
    employeeCount.mockResolvedValue(1);
    const service = new ReportsService(prisma, authorizationService as any, { getWorkingDates: workingDates } as any);

    await expect(service.getMonthlyAttendanceReport({ id: 1, role }, { month: '2026-08' } as any)).resolves.toMatchObject({
      meta: { month: '2026-08', page: 1, pageSize: 25, total: 1, totalPages: 1 },
      summary: { totalEmployees: 1 },
    });
  });

  it('denies Finance and Employee monthly Reports access', async () => {
    const service = new ReportsService(prisma, authorizationService as any, { getWorkingDates: workingDates } as any);

    await expect(service.getMonthlyAttendanceReport({ id: 2, role: 'FINANCE_MANAGER' }, { month: '2026-08' } as any)).rejects.toThrow(ForbiddenException);
    await expect(service.getMonthlyAttendanceReport({ id: 3, role: 'EMPLOYEE', employeeId: 3 }, { month: '2026-08' } as any)).rejects.toThrow(ForbiddenException);
  });

  it('restricts manager team filters inside the authenticated managed-team scope', async () => {
    authorizationService.canAccessOrganizationWide.mockReturnValue(false);
    teamFindMany.mockResolvedValue([{ id: 7 }]);
    employeeFindMany.mockResolvedValue([employee(1, 10)]);
    const service = new ReportsService(prisma, authorizationService as any, { getWorkingDates: workingDates } as any);

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

  it('calculates half days, virtual absences, leave, and summary across the full scope', async () => {
    const rows = [employee(1, 10), employee(2, 20)];
    employeeCount.mockResolvedValue(2);
    employeeFindMany.mockImplementation((args: any) =>
      args.take ? rows.slice(args.skip ?? 0, (args.skip ?? 0) + args.take) : rows,
    );
    workingDates.mockResolvedValue([
      new Date(2026, 7, 3),
      new Date(2026, 7, 4),
      new Date(2026, 7, 5),
    ]);
    attendanceFindMany.mockResolvedValue([
      { userId: 10, date: new Date(2026, 7, 3), status: AttendanceStatus.PRESENT, clockIn: new Date(2026, 7, 3, 9) },
      { userId: 10, date: new Date(2026, 7, 4), status: AttendanceStatus.HALF_DAY, clockIn: new Date(2026, 7, 4, 9) },
    ]);
    leaveFindMany.mockResolvedValue([
      {
        employeeId: 2,
        startDate: new Date(2026, 7, 4),
        endDate: new Date(2026, 7, 4),
        durationType: 'FULL_DAY',
        totalDays: 1,
      },
    ]);
    const service = new ReportsService(prisma, authorizationService as any, { getWorkingDates: workingDates } as any);

    const result = await service.getMonthlyAttendanceReport({ id: 1, role: 'HR' }, { month: '2026-08', page: 1, pageSize: 1 } as any);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      workingDays: 3,
      presentDays: 1,
      halfDays: 1,
      absentDays: 1,
      presentEquivalentDays: 1.5,
    });
    expect(result.summary).toMatchObject({
      totalEmployees: 2,
      totalWorkingDays: 6,
      totalPresentDays: 1,
      totalHalfDays: 1,
      totalAbsentDays: 3,
      totalApprovedLeaveDays: 1,
      totalPresentEquivalentDays: 1.5,
    });
    expect(result.meta).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
  });

  it('applies the status filter server-side using monthly daily status semantics', async () => {
    employeeFindMany.mockResolvedValue([employee(1, 10), employee(2, 20)]);
    employeeCount.mockResolvedValue(2);
    workingDates.mockResolvedValue([new Date(2026, 7, 3)]);
    attendanceFindMany.mockResolvedValue([
      { userId: 10, date: new Date(2026, 7, 3), status: AttendanceStatus.PRESENT, clockIn: new Date() },
    ]);
    const service = new ReportsService(prisma, authorizationService as any, { getWorkingDates: workingDates } as any);

    const result = await service.getMonthlyAttendanceReport({ id: 1, role: 'HR' }, { month: '2026-08', status: AttendanceStatus.PRESENT } as any);

    expect(result.data.map((row) => row.employeeId)).toEqual([1]);
    expect(result.summary.totalEmployees).toBe(1);
  });

  it.each([
    ['2026-01', new Date(2026, 0, 1), new Date(2026, 1, 1)],
    ['2025-12', new Date(2025, 11, 1), new Date(2026, 0, 1)],
  ])('uses an exclusive next-month boundary for %s', async (month, start, nextStart) => {
    employeeFindMany.mockResolvedValue([employee(1, 10)]);
    const service = new ReportsService(prisma, authorizationService as any, { getWorkingDates: workingDates } as any);

    await service.getMonthlyAttendanceReport({ id: 1, role: 'HR' }, { month } as any);

    expect(attendanceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ date: { gte: start, lt: nextStart } }),
    }));
  });

  it('excludes future current-month dates from the report calculation', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 10, 12));
    try {
      employeeFindMany.mockResolvedValue([employee(1, 10)]);
      const service = new ReportsService(prisma, authorizationService as any, { getWorkingDates: workingDates } as any);

      await service.getMonthlyAttendanceReport({ id: 1, role: 'HR' }, { month: '2026-09' } as any);

      expect(attendanceFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ date: { gte: new Date(2026, 8, 1), lt: new Date(2026, 8, 11) } }),
      }));
    } finally {
      jest.useRealTimers();
    }
  });
});
