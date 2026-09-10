import { Reflector } from '@nestjs/core';
import { EmployeeSelfOrAdminGuard } from '../common/guards/employee-self-or-admin.guard';
import { EmployeesController } from './employees.controller';

describe('EmployeesController Employee 360 attendance route', () => {
  const attendanceService = {
    getTargetEmployeeAttendanceSummary: jest.fn(),
  } as any;
  const controller = new EmployeesController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    attendanceService,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    attendanceService.getTargetEmployeeAttendanceSummary.mockResolvedValue({
      employeeId: 7,
      month: '2026-09',
      workingDays: 20,
      presentDays: 15,
      halfDays: 1,
      leaveDays: 2,
      absentDays: 2,
      presentEquivalentDays: 15.5,
      attendancePercentage: 77.5,
    });
  });

  it('exposes GET /employees/:id/360/attendance with the existing guard and roles', async () => {
    const route = Reflect.getMetadata('path', EmployeesController.prototype.getEmployee360Attendance);
    const guards = Reflect.getMetadata('__guards__', EmployeesController.prototype.getEmployee360Attendance);
    const roles = Reflect.getMetadata('roles', EmployeesController.prototype.getEmployee360Attendance);

    expect(route).toBe(' :id/360/attendance'.trim());
    expect(guards).toContain(EmployeeSelfOrAdminGuard);
    expect(roles).toEqual([
      'SUPER_ADMIN',
      'CEO',
      'HR',
      'FINANCE_MANAGER',
      'IT_MANAGER',
      'SALES_MANAGER',
      'EMPLOYEE',
    ]);
  });

  it('passes only the authenticated user, route employee ID, and month to the existing service', async () => {
    const user = {
      id: 1,
      role: 'EMPLOYEE',
      employeeId: 7,
      teamId: 999,
      managerId: 999,
      requestedEmployeeId: 999,
    };
    const request = { user };

    await expect(
      controller.getEmployee360Attendance(7, '2026-09', request),
    ).resolves.toEqual(expect.objectContaining({ employeeId: 7, month: '2026-09' }));

    expect(attendanceService.getTargetEmployeeAttendanceSummary).toHaveBeenCalledWith(
      user,
      7,
      '2026-09',
    );
  });

  it('does not use client-supplied alternate identity fields', async () => {
    const user = {
      id: 1,
      role: 'IT_MANAGER',
      employeeId: 10,
      teamId: 999,
      managerId: 999,
      targetEmployeeId: 999,
    };

    await controller.getEmployee360Attendance(7, '2026-09', { user });

    expect(attendanceService.getTargetEmployeeAttendanceSummary).toHaveBeenCalledWith(
      user,
      7,
      '2026-09',
    );
  });
});