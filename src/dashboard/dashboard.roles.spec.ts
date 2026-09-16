import { DashboardService } from './dashboard.service';

describe('DashboardService role read model', () => {
  const employees = [
    { id: 1, userId: 11, empCode: 'E1', firstName: 'One', lastName: 'User', department: 'IT', status: 'ACTIVE' },
    { id: 2, userId: 22, empCode: 'E2', firstName: 'Two', lastName: 'User', department: 'IT', status: 'ACTIVE' },
  ];

  const createService = () => {
    const prisma = {
      employee: {
        count: jest.fn().mockResolvedValue(2),
        findUnique: jest.fn(),
      },
      attendanceRegularization: { count: jest.fn().mockResolvedValue(0) },
      payroll: { findMany: jest.fn().mockResolvedValue([]) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      wFHRequest: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const attendance = {
      getTodayStatus: jest.fn(),
      getAttendanceHistory: jest.fn(),
    } as any;
    const service = new DashboardService(prisma, { getWorkingDates: jest.fn().mockResolvedValue([new Date()]) } as any, attendance);
    jest.spyOn(service as any, 'getEmployeesInScope').mockResolvedValue(employees);
    jest.spyOn(service as any, 'getTodayWorkforce').mockResolvedValue({
      present: 1, late: 0, halfDay: 0, leave: 0, absent: 1, inProgress: 0,
      byEmployee: employees.map((employee) => ({ employeeId: employee.id, department: employee.department, status: 'PRESENT' })),
    });
    jest.spyOn(service as any, 'getPendingLeaves').mockResolvedValue([]);
    jest.spyOn(service as any, 'getPendingWfh').mockResolvedValue([]);
    return { service, prisma, attendance };
  };

  it.each(['SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER'])('returns scoped workforce KPIs for %s', async (role) => {
    const { service } = createService();
    const result = await service.getDashboard({ id: 1, role, employeeId: 1 });
    expect(result.role).toBe(role);
    expect(result.kpis).toEqual(expect.objectContaining({ totalEmployees: 2, presentToday: 1, absentToday: 1 }));
    expect(result.departmentSummary).toEqual([
      expect.objectContaining({ department: 'IT', employeeCount: 2 }),
    ]);
  });

  it('returns payroll-only organization data for FINANCE_MANAGER', async () => {
    const { service, prisma } = createService();
    prisma.payroll.findMany.mockResolvedValue([
      { employeeId: 1, status: 'DRAFT', grossSalary: 100, netSalary: 80, lopDays: 1 },
      { employeeId: 2, status: 'PAID', grossSalary: 200, netSalary: 160, lopDays: 0 },
    ]);
    const result = await service.getDashboard({ id: 1, role: 'FINANCE_MANAGER', employeeId: 1 });
    expect(result.role).toBe('FINANCE_MANAGER');
    expect(result.kpis).toEqual(expect.objectContaining({ payrollEmployeePopulation: 2, draftPayrolls: 1, paidPayrolls: 1 }));
    expect(result).not.toHaveProperty('workforce');
  });

  it('returns only the authenticated employee shape for EMPLOYEE', async () => {
    const { service, prisma, attendance } = createService();
    prisma.employee.findUnique.mockResolvedValue({ id: 7, userId: 70, firstName: 'Self', lastName: 'User', department: 'IT', status: 'ACTIVE' });
    attendance.getAttendanceHistory.mockResolvedValue([{ status: 'PRESENT' }, { status: 'HALF_DAY' }]);
    attendance.getTodayStatus.mockResolvedValue({ status: 'IN_PROGRESS' });
    const result = await service.getDashboard({ id: 7, role: 'EMPLOYEE', employeeId: 7 });
    expect(result.role).toBe('EMPLOYEE');
    expect(result.employee.id).toBe(7);
    expect(result.month).toEqual(expect.objectContaining({ presentDays: 1, halfDays: 1 }));
    expect(result).not.toHaveProperty('departmentSummary');
  });
});
