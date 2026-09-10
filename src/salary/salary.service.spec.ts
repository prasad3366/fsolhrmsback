import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalaryService } from './salary.service';

describe('SalaryService assignment', () => {
  const prisma = {
    employee: { findUnique: jest.fn() },
    salaryStructure: { findUnique: jest.fn() },
    employeeSalary: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  } as any;
  const employeesService = { findByEmpCode: jest.fn() } as any;
  let service: SalaryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SalaryService(prisma, employeesService);
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.salaryStructure.findUnique.mockResolvedValue({ id: 3 });
    prisma.salaryStructure.findFirst = jest.fn().mockResolvedValue({ id: 3 });
    prisma.employeeSalary.findFirst.mockResolvedValue(null);
    prisma.employeeSalary.create.mockResolvedValue({ id: 10 });
  });

  it('accepts frontend payload aliases and creates a normalized assignment', async () => {
    await expect(service.assignSalary({
      employee: '7',
      annualCtc: '120000',
      salaryStructureId: '3',
    })).resolves.toEqual({ id: 10 });

    expect(prisma.employeeSalary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        employeeId: 7,
        structureId: 3,
        annualCTC: 120000,
        monthlyCTC: 10000,
      }),
      include: expect.any(Object),
    }));
  });

  it('rejects an employee who already has a salary assignment', async () => {
    prisma.employeeSalary.findFirst.mockResolvedValue({ id: 9 });

    await expect(service.assignSalary({
      employeeId: 7,
      annualCTC: 120000,
      structureId: 3,
    })).rejects.toThrow(BadRequestException);
    expect(prisma.employeeSalary.create).not.toHaveBeenCalled();
  });

  it('falls back to the first available salary structure', async () => {
    prisma.salaryStructure.findUnique.mockResolvedValue(null);

    await expect(service.assignSalary({
      employeeId: 7,
      annualCTC: 120000,
      structureId: 99,
    })).resolves.toEqual({ id: 10 });
    expect(prisma.salaryStructure.findFirst).toHaveBeenCalledWith({
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    expect(prisma.employeeSalary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ structureId: 3 }),
    }));
  });

  it('reports when no salary structures are configured', async () => {
    prisma.salaryStructure.findUnique.mockResolvedValue(null);
    prisma.salaryStructure.findFirst.mockResolvedValue(null);

    await expect(service.assignSalary({
      employeeId: 7,
      annualCTC: 120000,
      structureId: 99,
    })).rejects.toThrow(NotFoundException);
    expect(prisma.employeeSalary.create).not.toHaveBeenCalled();
  });

  it('converts unexpected database failures to a bad request', async () => {
    prisma.employeeSalary.create.mockRejectedValue(new Error('foreign key failure'));

    await expect(service.assignSalary({
      employeeId: 7,
      annualCTC: 120000,
      structureId: 3,
    })).rejects.toThrow(BadRequestException);
  });

  it('returns the latest salary assignment as a single record', async () => {
    const latest = { id: 10, employeeId: 7 };
    prisma.employeeSalary.findFirst.mockResolvedValue(latest);

    await expect(service.getLatestEmployeeSalary(7)).resolves.toBe(latest);
    expect(prisma.employeeSalary.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { employeeId: 7 },
      orderBy: { effectiveFrom: 'desc' },
    }));
  });

  it('reports an employee with no salary assignment', async () => {
    prisma.employeeSalary.findFirst.mockResolvedValue(null);

    await expect(service.getLatestEmployeeSalary(7)).rejects.toThrow(NotFoundException);
  });
});
