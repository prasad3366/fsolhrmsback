import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

describe('AttendanceController history queries', () => {
  const service = {
    getAttendanceHistory: jest.fn(),
    getMyAttendanceForEmployee: jest.fn(),
    getTodayStatusForEmployee: jest.fn(),
    getTodayAttendance: jest.fn(),
      canAccessEmployeeAttendance: jest.fn().mockResolvedValue(true),
    punchIn: jest.fn(),
    punchOut: jest.fn(),
  } as unknown as jest.Mocked<AttendanceService>;
  const authorizationService = {
    canAccessEmployee: jest.fn().mockResolvedValue(true),
    canAccessOrganizationWide: jest.fn().mockReturnValue(true),
  } as any;
  let controller: AttendanceController;

  beforeEach(() => {
    jest.clearAllMocks();
    authorizationService.canAccessEmployee.mockResolvedValue(true);
    service.canAccessEmployeeAttendance.mockResolvedValue(true);
    authorizationService.canAccessOrganizationWide.mockReturnValue(true);
    controller = new AttendanceController(service, authorizationService);
  });

  it('passes monthly status filters to the user history query', async () => {
    const records = [{ id: 1, status: AttendanceStatus.PRESENT }];
    service.getMyAttendanceForEmployee.mockResolvedValue(records as any);

    await expect(controller.getMyAttendance(
      { user: { id: 70, role: 'HR', employeeId: 7 } },
      { month: '9', year: '2026', status: AttendanceStatus.PRESENT } as any,
    )).resolves.toBe(records);

    expect(service.getMyAttendanceForEmployee).toHaveBeenCalledWith(
      7,
      9,
      2026,
      AttendanceStatus.PRESENT,
      undefined,
      undefined,
    );
    expect(authorizationService.canAccessEmployee).not.toHaveBeenCalled();
  });

  it('uses the JWT employee identity for an employee monthly history request', async () => {
    const records = [{ id: 1, status: AttendanceStatus.PRESENT }];
    service.getMyAttendanceForEmployee.mockResolvedValue(records as any);

    await expect(controller.getMyAttendance(
      { user: { id: 70, role: 'EMPLOYEE', employeeId: 7 } },
      { month: '9', year: '2026', employeeId: '99' } as any,
    )).resolves.toBe(records);

    expect(service.getMyAttendanceForEmployee).toHaveBeenCalledWith(7, 9, 2026, undefined, undefined, undefined);
    expect(service.getAttendanceHistory).not.toHaveBeenCalled();
  });

  it('maps the employee monthly route to virtual-record-aware history', async () => {
    const records = [{ date: new Date(2026, 8, 2), status: AttendanceStatus.ABSENT }];
    service.getMyAttendanceForEmployee.mockResolvedValue(records as any);

    await expect(controller.getEmployeeMonthlyAttendance(
      { user: { id: 70 } },
      '7',
      '9',
      '2026',
      AttendanceStatus.ABSENT,
    )).resolves.toBe(records);

    expect(service.getMyAttendanceForEmployee).toHaveBeenCalledWith(
      7,
      9,
      2026,
      AttendanceStatus.ABSENT,
    );
  });

  it('allows an authorized team manager to request employee attendance', async () => {
    service.getMyAttendanceForEmployee.mockResolvedValue([] as any);
    authorizationService.canAccessOrganizationWide.mockReturnValue(false);
    const user = { id: 70, role: 'SALES_MANAGER', employeeId: 10 };

    await expect(controller.getEmployeeMonthlyAttendance(
      { user },
      '7',
      '9',
      '2026',
    )).resolves.toEqual([]);

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(user, 7);
  });

  it('denies a team manager outside the authorized employee scope', async () => {
    authorizationService.canAccessOrganizationWide.mockReturnValue(false);
    authorizationService.canAccessEmployee.mockResolvedValue(false);
    service.canAccessEmployeeAttendance.mockResolvedValue(false);

    await expect(controller.getEmployeeMonthlyAttendance(
      { user: { id: 70, role: 'IT_MANAGER', employeeId: 10 } },
      '7',
      '9',
      '2026',
    )).rejects.toThrow('Access denied');

    expect(service.getMyAttendanceForEmployee).not.toHaveBeenCalled();
  });

  it('uses the JWT employee identity for an employee self-history request', async () => {
    service.getMyAttendanceForEmployee.mockResolvedValue([] as any);
    const user = { id: 70, role: 'EMPLOYEE', employeeId: 7 };

    await expect(controller.getMyAttendance(
      { user },
      { status: AttendanceStatus.HALF_DAY, employeeId: '99' } as any,
    )).resolves.toEqual([]);

    expect(service.getMyAttendanceForEmployee).toHaveBeenCalledWith(
      7,
      undefined,
      undefined,
      AttendanceStatus.HALF_DAY,
      undefined,
      undefined,
    );
    expect(authorizationService.canAccessEmployee).not.toHaveBeenCalled();
  });

  it('rejects an employee self-history request without JWT employee identity', async () => {
    await expect(controller.getMyAttendance(
      { user: { id: 70, role: 'EMPLOYEE' } },
      {} as any,
    )).rejects.toThrow(UnauthorizedException);

    expect(service.getMyAttendanceForEmployee).not.toHaveBeenCalled();
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER', 'IT_MANAGER', 'SALES_MANAGER', 'EMPLOYEE'])
    ('allows %s to access self today status and punch actions without team authorization', async (role) => {
      service.getTodayAttendance.mockResolvedValue({ state: 'NOT_CHECKED_IN' } as any);
      service.punchIn.mockResolvedValue({ id: 1 } as any);
      service.punchOut.mockResolvedValue({ id: 1 } as any);
      const req = { user: { id: 70, role, employeeId: 7 }, ip: '127.0.0.1' };

      await expect(controller.getToday(req)).resolves.toEqual({ state: 'NOT_CHECKED_IN' });
      await expect(controller.punchIn(req, { latitude: 1, longitude: 2 })).resolves.toEqual({ id: 1 });
      await expect(controller.punchOut(req, { latitude: 1, longitude: 2 })).resolves.toEqual({ id: 1 });

      expect(service.getTodayAttendance).toHaveBeenCalledWith(7);
      expect(service.punchIn).toHaveBeenCalledWith(7, 1, 2);
      expect(service.punchOut).toHaveBeenCalledWith(7, 1, 2);
      expect(authorizationService.canAccessEmployee).not.toHaveBeenCalled();
    });

  it('rejects self today status and punches without an authenticated employeeId', async () => {
    const req = { user: { id: 70, role: 'HR' }, ip: '127.0.0.1' };

    await expect(controller.getToday(req)).rejects.toThrow(UnauthorizedException);
    await expect(controller.punchIn(req, { latitude: 1, longitude: 2 })).rejects.toThrow(UnauthorizedException);
    await expect(controller.punchOut(req, { latitude: 1, longitude: 2 })).rejects.toThrow(UnauthorizedException);
    expect(authorizationService.canAccessEmployee).not.toHaveBeenCalled();
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER', 'IT_MANAGER', 'SALES_MANAGER', 'EMPLOYEE'])(
    'allows %s to request own monthly history without team authorization',
    async (role) => {
      service.getMyAttendanceForEmployee.mockResolvedValue([] as any);

      await expect(controller.getMyAttendance(
        { user: { id: 70, role, employeeId: 7 } },
        { month: '9', year: '2026', page: '1', pageSize: '10' } as any,
      )).resolves.toEqual([]);

      expect(authorizationService.canAccessEmployee).not.toHaveBeenCalled();
      expect(service.getMyAttendanceForEmployee).toHaveBeenCalledWith(7, 9, 2026, undefined, 1, 10);
    },
  );

  it('ignores a client-supplied employeeId for self-history', async () => {
    service.getMyAttendanceForEmployee.mockResolvedValue([] as any);

    await controller.getMyAttendance(
      { user: { id: 70, role: 'HR', employeeId: 7 } },
      { month: '9', year: '2026', employeeId: '999', page: '1', pageSize: '10' } as any,
    );

    expect(service.getMyAttendanceForEmployee).toHaveBeenCalledWith(7, 9, 2026, undefined, 1, 10);
  });

  it('rejects partial month and year filters before querying', async () => {
    await expect(controller.getMyAttendance(
      { user: { id: 70, employeeId: 7 } },
      { month: '9' } as any,
    )).rejects.toThrow(BadRequestException);

    await expect(controller.getMyAttendance(
      { user: { id: 70, employeeId: 7 } },
      { year: '2026' } as any,
    )).rejects.toThrow('Month and year must be provided together');

    expect(service.getAttendanceHistory).not.toHaveBeenCalled();
    expect(service.getMyAttendanceForEmployee).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range month before querying', async () => {
    await expect(controller.getMyAttendance(
      { user: { id: 70, employeeId: 7 } },
      { month: '13', year: '2026' } as any,
    )).rejects.toThrow('Month must be between 1 and 12');

    expect(service.getAttendanceHistory).not.toHaveBeenCalled();
  });
});
