import { ForbiddenException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';

describe('DashboardService attendance export authorization', () => {
  const createService = () => {
    const prisma = {
      employee: { findMany: jest.fn(), findUnique: jest.fn() },
      team: { findMany: jest.fn() },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      leave: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const workingDaysService = {
      getWorkingDates: jest.fn(async (_employeeId: number, dates: Date[]) => dates),
    } as any;
    return { service: new DashboardService(prisma, workingDaysService), prisma, workingDaysService };
  };

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s organization-wide export', async (role) => {
    const { service, prisma } = createService();
    prisma.employee.findMany.mockResolvedValue([
      { id: 1, empCode: 'E1', firstName: 'One', lastName: 'User' },
      { id: 2, empCode: 'E2', firstName: 'Two', lastName: 'User' },
    ]);

    const csv = await service.exportAttendanceCsv(9, 2026, { role, employeeId: 10 });

    expect(csv).toContain('E1,One User');
    expect(csv).toContain('E2,Two User');
    expect(prisma.employee.findMany).toHaveBeenCalledTimes(1);
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER'])('restricts %s export to authorized persisted team members', async (role) => {
    const { service, prisma } = createService();
    prisma.team.findMany.mockResolvedValue([
      {
        id: 3,
        managerId: 10,
        members: [
          { id: 21, empCode: 'IN', firstName: 'In', lastName: 'Team' },
          { id: 22, empCode: 'OUT', firstName: 'Out', lastName: 'Team' },
        ],
      },
    ]);
    const authorizationService = (service as any).authorizationService;
    jest.spyOn(authorizationService, 'canAccessEmployee')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const csv = await service.exportAttendanceCsv(9, 2026, { role, employeeId: 10 });

    expect(csv).toContain('IN,In Team');
    expect(csv).not.toContain('OUT,Out Team');
    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(
      { role, employeeId: 10 },
      21,
    );
    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(
      { role, employeeId: 10 },
      22,
    );
  });

  it.each(['FINANCE_MANAGER', 'EMPLOYEE', 'UNKNOWN', ''])('denies %s export', async (role) => {
    const { service, prisma } = createService();

    await expect(
      service.exportAttendanceCsv(9, 2026, { role, employeeId: 10 }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.employee.findMany).not.toHaveBeenCalled();
    expect(prisma.team.findMany).not.toHaveBeenCalled();
  });

  it('denies manager export when authenticated manager identity is missing', async () => {
    const { service } = createService();

    await expect(
      service.exportAttendanceCsv(9, 2026, { role: 'IT_MANAGER', employeeId: null }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('fails closed when the authenticated user is missing', async () => {
    const { service } = createService();

    await expect(service.exportAttendanceCsv(9, 2026, undefined as any)).rejects.toThrow(
      ForbiddenException,
    );
  });

  const createCalculationService = (
    teamName: string | null,
    holidays: Date[] = [],
    attendanceRecords: any[] = [],
    leaves: any[] = [],
  ) => {
    const employee = {
      id: 7,
      userId: 70,
      empCode: 'E7',
      firstName: 'Test',
      lastName: 'Employee',
    };
    const holidayService = {
      isHoliday: jest.fn(async (date: Date) =>
        holidays.some((holiday) => holiday.getTime() === date.getTime())
          ? { date }
          : null,
      ),
    } as any;
    const prisma = {
      employee: {
        findMany: jest.fn().mockResolvedValue([employee]),
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          team: teamName ? { name: teamName } : null,
        }),
      },
      team: { findMany: jest.fn() },
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue(
          attendanceRecords.map((record) => ({
            ...record,
            user: { employee },
          })),
        ),
      },
      attendance: { findMany: jest.fn().mockResolvedValue(attendanceRecords) },
      leave: { findMany: jest.fn().mockResolvedValue(leaves) },
    } as any;
    const workingDaysService = new WorkingDaysService(prisma, holidayService);
    const service = new DashboardService(prisma, workingDaysService);

    return { service, prisma };
  };

  it('counts normal employee Monday-Friday working days and excludes Sunday/Saturday attendance', async () => {
    const { service } = createCalculationService(null, [], [
      { employeeId: 7, date: new Date(2026, 7, 3), status: 'PRESENT', clockIn: new Date(2026, 7, 3, 9), clockOut: new Date(2026, 7, 3, 17) },
      { employeeId: 7, date: new Date(2026, 7, 6), status: 'PRESENT', clockIn: new Date(2026, 7, 6, 9), clockOut: new Date(2026, 7, 6, 17) },
    ]);

    const csv = await service.exportAttendanceCsv(8, 2026, { role: 'HR', employeeId: 10 });

    expect(csv).toContain('E7,Test Employee,21,2,0');
  });

  it('counts a Sales Saturday as a working day while excluding Sunday', async () => {
    const { service } = createCalculationService('SALES', [], [
      { employeeId: 7, date: new Date(2026, 7, 1), status: 'PRESENT', clockIn: new Date(2026, 7, 1, 9), clockOut: new Date(2026, 7, 1, 17) },
      { employeeId: 7, date: new Date(2026, 7, 8), status: 'PRESENT', clockIn: new Date(2026, 7, 8, 9), clockOut: new Date(2026, 7, 8, 17) },
    ]);

    const csv = await service.exportAttendanceCsv(8, 2026, { role: 'HR', employeeId: 10 });

    expect(csv).toContain('E7,Test Employee,26,2,0');
  });

  it('excludes holidays from Dashboard working days and attendance for Sales', async () => {
    const holiday = new Date(2026, 7, 1);
    const { service } = createCalculationService(
      'SALES',
      [holiday],
      [{ employeeId: 7, date: holiday, status: 'PRESENT' }],
    );

    const csv = await service.exportAttendanceCsv(8, 2026, { role: 'HR', employeeId: 10 });

    expect(csv).toContain('E7,Test Employee,25,0,0');
  });

  it('does not count open PRESENT or LATE records as present', async () => {
    const { service } = createCalculationService(null, [], [
      { employeeId: 7, date: new Date(2026, 7, 3), status: 'PRESENT', clockIn: new Date(2026, 7, 3, 9), clockOut: null },
      { employeeId: 7, date: new Date(2026, 7, 6), status: 'LATE', clockIn: new Date(2026, 7, 6, 10), clockOut: null },
      { employeeId: 7, date: new Date(2026, 7, 7), status: 'PRESENT', clockIn: new Date(2026, 7, 7, 9), clockOut: new Date(2026, 7, 7, 17) },
    ]);

    const csv = await service.exportAttendanceCsv(8, 2026, { role: 'HR', employeeId: 10 });

    expect(csv).toContain('E7,Test Employee,21,1,0');
  });

  it('uses the canonical completed-duration thresholds for Dashboard attendance', async () => {
    const { service } = createCalculationService(null, [], [
      { employeeId: 7, date: new Date(2026, 7, 3), status: 'LATE', clockIn: new Date(2026, 7, 3, 9), clockOut: new Date(2026, 7, 3, 16) },
      { employeeId: 7, date: new Date(2026, 7, 4), status: 'HALF_DAY', clockIn: new Date(2026, 7, 4, 9), clockOut: new Date(2026, 7, 4, 13) },
      { employeeId: 7, date: new Date(2026, 7, 5), status: 'ABSENT', clockIn: new Date(2026, 7, 5, 9), clockOut: new Date(2026, 7, 5, 12) },
    ]);

    const csv = await service.exportAttendanceCsv(8, 2026, { role: 'HR', employeeId: 10 });

    expect(csv).toContain('E7,Test Employee,21,1,1,19,0');
  });

  it('counts approved leave as leave and ignores pending/rejected/cancelled leave', async () => {
    const { service } = createCalculationService('SALES', [], [], [
      { employeeId: 7, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), totalDays: 1, status: 'APPROVED' },
      { employeeId: 7, startDate: new Date(2026, 7, 2), endDate: new Date(2026, 7, 2), totalDays: 1, status: 'PENDING' },
      { employeeId: 7, startDate: new Date(2026, 7, 3), endDate: new Date(2026, 7, 3), totalDays: 1, status: 'REJECTED' },
      { employeeId: 7, startDate: new Date(2026, 7, 4), endDate: new Date(2026, 7, 4), totalDays: 1, status: 'CANCELLED' },
    ]);

    const csv = await service.exportAttendanceCsv(8, 2026, { role: 'HR', employeeId: 10 });

    expect(csv).toContain('E7,Test Employee,26,0,0,25,1');
  });

  it('counts approved leave using the shared eligible working-day definition', async () => {
    const { service } = createCalculationService('SALES', [], [], [{
      employeeId: 7,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 3),
      totalDays: 2,
      status: 'APPROVED',
    }]);

    const csv = await service.exportAttendanceCsv(8, 2026, { role: 'HR', employeeId: 10 });

    expect(csv).toContain('E7,Test Employee,26,0,0,24,2');
  });

  it('keeps the Dashboard attendance breakdown reconcilable', async () => {
    const { service } = createCalculationService(null, [], [
      { employeeId: 7, date: new Date(2026, 7, 3), status: 'PRESENT', clockIn: new Date(2026, 7, 3, 9), clockOut: new Date(2026, 7, 3, 17) },
      { employeeId: 7, date: new Date(2026, 7, 4), status: 'HALF_DAY', clockIn: new Date(2026, 7, 4, 9), clockOut: new Date(2026, 7, 4, 13) },
      { employeeId: 7, date: new Date(2026, 7, 5), status: 'ABSENT', clockIn: null, clockOut: null },
    ]);

    const [, row] = (await service.exportAttendanceCsv(8, 2026, { role: 'HR', employeeId: 10 })).split('\n');
    const [, , workingDays, presentDays, halfDays, absentDays, leaveDays] = row.split(',').map(Number);

    expect(workingDays).toBe(Number(presentDays) + Number(halfDays) + Number(absentDays) + Number(leaveDays));
  });
});