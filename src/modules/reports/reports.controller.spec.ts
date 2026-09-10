import { ReportsController } from './reports.controller';

describe('ReportsController authenticated scope', () => {
  it('passes only authenticated request.user to ReportsService', async () => {
    const user = { id: 3, role: 'IT_MANAGER', employeeId: 10 };
    const getEmployeeReportData = jest.fn().mockResolvedValue([]);
    const controller = new ReportsController({ getEmployeeReportData } as any);

    await controller.exportEmployees({ user } as any);

    expect(getEmployeeReportData).toHaveBeenCalledWith(user);
  });

  it('does not accept client scope query values for employee reports', async () => {
    const user = { id: 3, role: 'SALES_MANAGER', employeeId: 11 };
    const getAttendanceReportData = jest.fn().mockResolvedValue([]);
    const controller = new ReportsController({ getAttendanceReportData } as any);

    await controller.exportAttendance(
      '2026-09-01',
      '2026-09-30',
      { user, query: { employeeId: 999, teamId: 999, managerId: 999 } } as any,
    );

    expect(getAttendanceReportData).toHaveBeenCalledWith(
      '2026-09-01',
      '2026-09-30',
      user,
    );
  });

  it('keeps the controller role metadata limited to approved management roles', () => {
    expect(Reflect.getMetadata('roles', ReportsController)).toEqual([
      'SUPER_ADMIN',
      'CEO',
      'HR',
      'FINANCE_MANAGER',
      'IT_MANAGER',
      'SALES_MANAGER',
    ]);
    expect(Reflect.getMetadata('roles', ReportsController)).not.toContain('EMPLOYEE');
    expect(Reflect.getMetadata('roles', ReportsController)).not.toContain('UNKNOWN');
  });
});
