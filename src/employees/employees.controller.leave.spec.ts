import { Reflector } from '@nestjs/core';
import { EmployeeSelfOrAdminGuard } from '../common/guards/employee-self-or-admin.guard';
import { EmployeesController } from './employees.controller';

describe('EmployeesController Employee 360 leave route', () => {
  const leaveService = {
    getTargetEmployeeLeaveSummary: jest.fn(),
  } as any;
  const controller = new EmployeesController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    leaveService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    leaveService.getTargetEmployeeLeaveSummary.mockResolvedValue({
      employeeId: 7,
      status: 'ACTIVE',
      currentLeaveStatus: { status: 'NOT_ON_LEAVE' },
      balanceSummary: [],
      leaveCounts: { total: 0, pending: 0, approved: 0, rejected: 0 },
      recentHistory: [],
    });
  });

  it('exposes GET /employees/:id/360/leave with the existing guard and roles', () => {
    const route = Reflect.getMetadata('path', EmployeesController.prototype.getEmployee360Leave);
    const guards = Reflect.getMetadata('__guards__', EmployeesController.prototype.getEmployee360Leave);
    const roles = Reflect.getMetadata('roles', EmployeesController.prototype.getEmployee360Leave);

    expect(route).toBe(':id/360/leave');
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

  it('passes only the authenticated user and route employee ID to the existing leave service', async () => {
    const user = {
      id: 1,
      role: 'EMPLOYEE',
      employeeId: 7,
      teamId: 999,
      managerId: 999,
      requestedEmployeeId: 999,
    };

    await expect(
      controller.getEmployee360Leave(7, { user }),
    ).resolves.toEqual(expect.objectContaining({ employeeId: 7 }));

    expect(leaveService.getTargetEmployeeLeaveSummary).toHaveBeenCalledWith(user, 7);
  });

  it('cannot substitute client-supplied identity fields for the route target', async () => {
    const user = {
      id: 1,
      role: 'IT_MANAGER',
      employeeId: 10,
      teamId: 999,
      managerId: 999,
      targetEmployeeId: 999,
    };

    await controller.getEmployee360Leave(7, { user });

    expect(leaveService.getTargetEmployeeLeaveSummary).toHaveBeenCalledWith(user, 7);
  });
});