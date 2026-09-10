import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../common/guards/roles.guard';
import { DashboardController } from './dashboard.controller';

describe('DashboardController attendance export policy', () => {
  it('allows only the approved export roles at the route boundary', () => {
    const roles = Reflect.getMetadata('roles', DashboardController.prototype.exportAttendance);
    const guards = Reflect.getMetadata('__guards__', DashboardController);

    expect(roles).toEqual(['SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER']);
    expect(roles).not.toContain('ADMIN');
    expect(roles).not.toContain('MANAGER');
    expect(roles).not.toContain('FINANCE_MANAGER');
    expect(guards).toContain(RolesGuard);
  });
});