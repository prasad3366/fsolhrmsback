import { ForbiddenException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { ReportsService } from './reports.service';

const adminRoles = ['SUPER_ADMIN', 'CEO', 'HR'];

describe('ReportsService authorization and scope', () => {
  const employeeFindMany = jest.fn();
  const employeeCount = jest.fn();
  const teamFindMany = jest.fn();
  const teamFindUnique = jest.fn();
  const authorizationService = {
    canAccessOrganizationWide: jest.fn(),
    canAccessTeam: jest.fn(),
  };
  const prisma = {
    employee: { findMany: employeeFindMany, count: employeeCount },
    team: { findMany: teamFindMany, findUnique: teamFindUnique },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    employeeFindMany.mockResolvedValue([]);
    employeeCount.mockResolvedValue(0);
    teamFindMany.mockResolvedValue([]);
    teamFindUnique.mockResolvedValue({ id: 1, managerId: 10 });
    authorizationService.canAccessOrganizationWide.mockImplementation(
      (user: { role: string }) => adminRoles.includes(user.role),
    );
    authorizationService.canAccessTeam.mockResolvedValue(true);
  });

  it.each(adminRoles)('allows %s organization-wide employee reports', async (role) => {
    const service = new ReportsService(prisma, authorizationService as any, {} as any);

    await service.getEmployeeReportData({ id: 1, role });

    expect(employeeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'ACTIVE' },
    }));
    expect(teamFindMany).not.toHaveBeenCalled();
  });

  it('denies FINANCE_MANAGER because AuthorizationService has no Reports scope for it', async () => {
    const service = new ReportsService(prisma, authorizationService as any, {} as any);

    await expect(
      service.getEmployeeReportData({ id: 2, role: 'FINANCE_MANAGER', employeeId: 20 }),
    ).rejects.toThrow(ForbiddenException);
    expect(employeeFindMany).not.toHaveBeenCalled();
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER'])('restricts %s reports to authenticated managed teams', async (role) => {
    teamFindMany.mockResolvedValue([{ id: 7 }]);
    employeeFindMany.mockResolvedValue([{ department: 'Engineering' }]);
    const service = new ReportsService(prisma, authorizationService as any, {} as any);

    await service.getEmployeeReportData({ id: 3, role, employeeId: 10 });

    expect(teamFindMany).toHaveBeenCalledWith({
      where: { managerId: 10 },
      select: { id: true },
    });
    expect(authorizationService.canAccessTeam).toHaveBeenCalledWith(
      { id: 3, role, employeeId: 10 },
      7,
    );
    expect(employeeFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { teamId: { in: [7] }, status: 'ACTIVE' },
    }));
  });

  it('returns no manager employee rows when the authenticated manager has no teams', async () => {
    const service = new ReportsService(prisma, authorizationService as any, {} as any);

    await service.getEmployeeReportData({ id: 3, role: 'IT_MANAGER', employeeId: 10 });

    expect(employeeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [] }, status: 'ACTIVE' },
    }));
  });

  it.each([
    ['EMPLOYEE', 4],
    ['UNKNOWN', 5],
    ['ADMIN', 6],
  ])('denies %s Reports access', async (role, id) => {
    const service = new ReportsService(prisma, authorizationService as any, {} as any);

    await expect(service.getEmployeeReportData({ id, role, employeeId: id })).rejects.toThrow(
      ForbiddenException,
    );
    expect(employeeFindMany).not.toHaveBeenCalled();
  });

  it('does not use client-supplied scope identifiers', async () => {
    teamFindMany.mockResolvedValue([{ id: 7 }]);
    employeeFindMany.mockResolvedValue([{ department: 'Engineering' }]);
    const service = new ReportsService(prisma, authorizationService as any, {} as any);
    const user = {
      id: 3,
      role: 'IT_MANAGER',
      employeeId: 10,
      teamId: 999,
      managerId: 999,
    } as any;

    await service.getEmployeeReportData(user);

    expect(teamFindMany).toHaveBeenCalledWith({ where: { managerId: 10 }, select: { id: true } });
    expect(employeeFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { teamId: { in: [7] }, status: 'ACTIVE' },
    }));
  });
});

describe('ReportsService attendance export safety', () => {
  it('does not count an open persisted PRESENT record as completed presence', async () => {
    const attendanceFindMany = jest.fn().mockResolvedValue([
      {
        date: new Date(2026, 7, 3),
        status: AttendanceStatus.PRESENT,
        clockIn: new Date(2026, 7, 3, 9),
        clockOut: null,
        user: { employee: { id: 7, empCode: 'E7', firstName: 'Open', lastName: 'Record', department: 'Engineering' } },
      },
      {
        date: new Date(2026, 7, 4),
        status: AttendanceStatus.PRESENT,
        clockIn: new Date(2026, 7, 4, 9),
        clockOut: new Date(2026, 7, 4, 17),
        user: { employee: { id: 7, empCode: 'E7', firstName: 'Open', lastName: 'Record', department: 'Engineering' } },
      },
    ]);
    const service = new ReportsService(
      {
        employee: { findMany: jest.fn(), count: jest.fn() },
        attendanceRecord: { findMany: attendanceFindMany },
      } as any,
      { canAccessOrganizationWide: jest.fn().mockReturnValue(true) } as any,
      {} as any,
    );

    await expect(service.getAttendanceReportData(undefined, undefined, { id: 1, role: 'HR' })).resolves.toEqual([
      expect.objectContaining({ employeeId: 7, totalPresentDays: 1, totalAbsentDays: 0, lateArrivals: 0 }),
    ]);
  });
});
