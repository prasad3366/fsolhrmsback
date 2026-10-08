import { ROLES_KEY } from '../common/decorators/roles.decorators';
import { SalaryController } from './salary.controller';
import { SalaryService } from './salary.service';

describe('SalaryController employee lookup', () => {
  const salaryService = {
    assignSalary: jest.fn(),
    getLatestEmployeeSalary: jest.fn(),
  } as unknown as SalaryService;
  const prisma = {} as any;
  let controller: SalaryController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SalaryController(salaryService, prisma);
    jest.spyOn((controller as any).authorizationService, 'canAccessOrganizationWide')
      .mockReturnValue(true);
    (salaryService.getLatestEmployeeSalary as jest.Mock).mockResolvedValue({ id: 10, employeeId: 7 });
    (salaryService.assignSalary as jest.Mock).mockResolvedValue({ id: 10, employeeId: 7 });
  });

  it('normalizes employeeId before assigning salary', async () => {
    await expect(controller.assignSalary(
      { employeeId: '7', annualCTC: 120000, structureId: 3 },
      { user: { role: 'HR' } },
    )).resolves.toEqual({ id: 10, employeeId: 7 });

    expect(salaryService.assignSalary).toHaveBeenCalledWith({
      employeeId: 7,
      annualCTC: 120000,
      structureId: 3,
    });
  });

  it('passes the employee route parameter as an integer', async () => {
    await expect(controller.getEmployeeSalaries('7', {
      user: { role: 'HR' },
    })).resolves.toEqual({ id: 10, employeeId: 7 });

    expect(salaryService.getLatestEmployeeSalary).toHaveBeenCalledWith(7);
  });

  it('passes Monthly Gross and effective date through to the service', async () => {
    await controller.assignSalary(
      { employeeId: '7', annualCTC: 660000, monthlyGross: 50000, effectiveFrom: '2026-11-01', structureId: 4 },
      { user: { role: 'CEO' } },
    );

    expect(salaryService.assignSalary).toHaveBeenCalledWith({
      employeeId: 7, annualCTC: 660000, monthlyGross: 50000, effectiveFrom: '2026-11-01', structureId: 4,
    });
  });
});

describe('SalaryController authorization', () => {
  const rolesOf = (method: string) => Reflect.getMetadata(ROLES_KEY, (SalaryController.prototype as any)[method]);

  it('keeps salary assignment for SUPER_ADMIN, CEO, HR and the existing FINANCE_MANAGER access', () => {
    expect(rolesOf('assignSalary')).toEqual(['SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER']);
  });

  it('limits salary structure creation to SUPER_ADMIN, CEO and HR', () => {
    expect(rolesOf('createSalaryStructure')).toEqual(['SUPER_ADMIN', 'CEO', 'HR']);
  });

  it('keeps structure listing on its existing roles', () => {
    expect(rolesOf('getSalaryStructures')).toEqual(['SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER']);
  });
});
