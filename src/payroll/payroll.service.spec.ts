import { BadRequestException } from '@nestjs/common';
import { PayrollService } from './payroll.service';

describe('PayrollService.addOther', () => {
  let prisma: any;
  let employeesService: any;
  let service: PayrollService;

  beforeEach(() => {
    prisma = {
      payroll: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      payrollAdjustment: {
        create: jest.fn(),
      },
    };

    employeesService = {};
    service = new PayrollService(prisma, employeesService, { canAccessEmployee: jest.fn() } as any, {
      getWorkingDates: jest.fn(),
    } as any);
  });

  it('persists a payroll adjustment and updates totals for a draft payroll', async () => {
    prisma.payroll.findUnique.mockResolvedValue({
      id: 1,
      grossSalary: 1000,
      deductions: 100,
      netSalary: 900,
      status: 'DRAFT',
    });

    prisma.payrollAdjustment.create.mockResolvedValue({
      id: 10,
      payrollId: 1,
      name: 'Bonus',
      type: 'ALLOWANCE',
      amount: 200,
    });

    prisma.payroll.update.mockResolvedValue({
      id: 1,
      grossSalary: 1200,
      deductions: 100,
      netSalary: 1100,
    });

    await expect(service.addOther(1, 'Bonus', 'ALLOWANCE', 200)).resolves.toEqual({
      id: 1,
      grossSalary: 1200,
      deductions: 100,
      netSalary: 1100,
    });

    expect(prisma.payrollAdjustment.create).toHaveBeenCalledWith({
      data: {
        payrollId: 1,
        name: 'Bonus',
        type: 'ALLOWANCE',
        amount: 200,
      },
    });

    expect(prisma.payroll.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        grossSalary: 1200,
        deductions: 100,
        netSalary: 1100,
      },
    });
  });

  it('rejects adjustments for finalized payroll', async () => {
    prisma.payroll.findUnique.mockResolvedValue({
      id: 1,
      grossSalary: 1000,
      deductions: 100,
      netSalary: 900,
      status: 'FINALIZED',
    });

    await expect(service.addOther(1, 'Bonus', 'ALLOWANCE', 200)).rejects.toThrow(
      BadRequestException,
    );

    expect(prisma.payrollAdjustment.create).not.toHaveBeenCalled();
    expect(prisma.payroll.update).not.toHaveBeenCalled();
  });

  it('rejects invalid adjustment payloads', async () => {
    await expect(service.addOther(0, 'Bonus', 'ALLOWANCE', 200)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.addOther(1, '', 'ALLOWANCE', 200)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.addOther(1, 'Bonus', 'INVALID' as any, 200)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.addOther(1, 'Bonus', 'ALLOWANCE', 0)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects non-integer employee ids before payroll generation', async () => {
    await expect(
      service.runPayroll({ employeeId: 1.5, month: 2, year: 2026 } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.runPayroll({ employeeId: 0, month: 2, year: 2026 } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid month and year values before payroll generation', async () => {
    await expect(
      service.runPayroll({ employeeId: 1, month: 13, year: 2026 } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.runPayroll({ employeeId: 1, month: 2, year: 0 } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.runPayroll({ employeeId: 1, month: Number.NaN, year: 2026 } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.runPayroll({ employeeId: 1, month: 2, year: Number.POSITIVE_INFINITY } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
