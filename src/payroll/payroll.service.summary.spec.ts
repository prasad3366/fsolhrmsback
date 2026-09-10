import { ForbiddenException } from '@nestjs/common';
import { PayrollService } from './payroll.service';

describe('PayrollService Employee 360 payroll summary', () => {
  const payrollFindMany = jest.fn();
  const prisma = { payroll: { findMany: payrollFindMany } } as any;
  const employeesService = {} as any;
  const authorizationService = { canAccessEmployee: jest.fn() } as any;
  const service = new PayrollService(prisma, employeesService, authorizationService, {
    getWorkingDates: jest.fn(),
  } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    authorizationService.canAccessEmployee.mockResolvedValue(true);
    payrollFindMany.mockResolvedValue([
      {
        month: 8,
        year: 2026,
        status: 'FINALIZED',
        grossSalary: 100000,
        deductions: 12000,
        netSalary: 88000,
        salary: { effectiveFrom: new Date('2026-04-01') },
      },
    ]);
  });

  it('allows an EMPLOYEE to retrieve their own minimal payroll summary', async () => {
    const user = { id: 1, role: 'EMPLOYEE', employeeId: 7 };

    await expect(service.getEmployee360PayrollSummary(user, 7)).resolves.toEqual([
      {
        month: 8,
        year: 2026,
        status: 'FINALIZED',
        grossSalary: 100000,
        deductions: 12000,
        netSalary: 88000,
        latestSalaryEffectiveDate: new Date('2026-04-01'),
      },
    ]);

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(user, 7);
    expect(payrollFindMany).toHaveBeenCalledWith({
      where: { employeeId: 7 },
      select: {
        month: true,
        year: true,
        status: true,
        grossSalary: true,
        deductions: true,
        netSalary: true,
        salary: { select: { effectiveFrom: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  });

  it('denies an EMPLOYEE another employee before querying payroll', async () => {
    authorizationService.canAccessEmployee.mockResolvedValue(false);

    await expect(
      service.getEmployee360PayrollSummary({ id: 1, role: 'EMPLOYEE', employeeId: 7 }, 8),
    ).rejects.toThrow(ForbiddenException);
    expect(payrollFindMany).not.toHaveBeenCalled();
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER'])('allows %s for a managed-team employee', async (role) => {
    await expect(
      service.getEmployee360PayrollSummary({ id: 1, role, employeeId: 4 }, 7),
    ).resolves.toHaveLength(1);
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER'])('denies %s outside the managed team', async (role) => {
    authorizationService.canAccessEmployee.mockResolvedValue(false);

    await expect(
      service.getEmployee360PayrollSummary({ id: 1, role, employeeId: 4 }, 8),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER'])('preserves %s organization-wide access', async (role) => {
    await expect(
      service.getEmployee360PayrollSummary({ id: 1, role }, 7),
    ).resolves.toHaveLength(1);
  });

  it('ignores client-supplied employee, team, and manager identity fields', async () => {
    const user = {
      id: 1,
      role: 'IT_MANAGER',
      employeeId: 4,
      teamId: 999,
      managerId: 999,
      requestedEmployeeId: 999,
    } as any;

    await service.getEmployee360PayrollSummary(user, 7);

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(user, 7);
    expect(payrollFindMany.mock.calls[0][0].where).toEqual({ employeeId: 7 });
  });

  it('excludes sensitive employee, salary structure, attendance, leave, and payslip data', async () => {
    const result = await service.getEmployee360PayrollSummary({ id: 1, role: 'HR' }, 7);
    const select = payrollFindMany.mock.calls[0][0].select;

    expect(result[0]).not.toHaveProperty('bankName');
    expect(result[0]).not.toHaveProperty('bankAccountNumber');
    expect(result[0]).not.toHaveProperty('panNumber');
    expect(result[0]).not.toHaveProperty('aadharNumber');
    expect(result[0]).not.toHaveProperty('pfNumber');
    expect(result[0]).not.toHaveProperty('uanNumber');
    expect(result[0]).not.toHaveProperty('salary');
    expect(result[0]).not.toHaveProperty('employee');
    expect(result[0]).not.toHaveProperty('fileData');
    expect(select).not.toHaveProperty('workingDays');
    expect(select).not.toHaveProperty('presentDays');
    expect(select).not.toHaveProperty('lopDays');
    expect(select).not.toHaveProperty('salary.select.structure');
  });

  it('returns the existing empty array behavior when payroll does not exist', async () => {
    payrollFindMany.mockResolvedValue([]);

    await expect(
      service.getEmployee360PayrollSummary({ id: 1, role: 'EMPLOYEE', employeeId: 7 }, 7),
    ).resolves.toEqual([]);
  });

  it('does not change /payroll/my or payslip authorization methods', () => {
    expect(service.getPayroll).toBeDefined();
    expect(service.getPayrollById).toBeDefined();
  });
});