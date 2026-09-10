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
    salaryService.getLatestEmployeeSalary.mockResolvedValue({ id: 10, employeeId: 7 });
    salaryService.assignSalary.mockResolvedValue({ id: 10, employeeId: 7 });
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
});
