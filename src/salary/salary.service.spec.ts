import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalaryService } from './salary.service';

describe('SalaryService assignment', () => {
  const legacyStructure = { id: 3, basicPercent: 35, hraPercent: 50, conveyancePercent: 15, conveyanceAmount: null, pfPercent: 12, ptAmount: 200 };
  const grossStructure = { id: 4, basicPercent: 35, hraPercent: 40, conveyancePercent: 0, conveyanceAmount: 2000, pfPercent: 12, ptAmount: 200 };
  const prisma = {
    employee: { findUnique: jest.fn() },
    salaryStructure: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    employeeSalary: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    payroll: { findFirst: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const employeesService = { findByEmpCode: jest.fn() } as any;
  let service: SalaryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SalaryService(prisma, employeesService);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.salaryStructure.findUnique.mockResolvedValue(legacyStructure);
    prisma.salaryStructure.findFirst.mockResolvedValue(legacyStructure);
    prisma.employeeSalary.findFirst.mockResolvedValue(null);
    prisma.employeeSalary.create.mockResolvedValue({ id: 10 });
    prisma.payroll.findFirst.mockResolvedValue(null);
    prisma.payroll.updateMany.mockResolvedValue({ count: 0 });
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
        monthlyGross: null,
      }),
      include: expect.any(Object),
    }));
  });

  it('stores Monthly Gross separately from CTC and the chosen effective date', async () => {
    prisma.salaryStructure.findUnique.mockResolvedValue(grossStructure);

    await service.assignSalary({ employeeId: 7, annualCTC: 660000, monthlyGross: 50000, structureId: 4, effectiveFrom: '2026-10-01' });

    expect(prisma.employeeSalary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        structureId: 4,
        annualCTC: 660000,
        monthlyCTC: 55000,
        monthlyGross: 50000,
        effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
      }),
    }));
  });

  it('gives an existing employee a new effective-dated row without touching the historical row', async () => {
    // An earlier salary exists, on a different date
    prisma.employeeSalary.findFirst.mockResolvedValue(null);
    prisma.salaryStructure.findUnique.mockResolvedValue(grossStructure);

    await expect(service.assignSalary({
      employeeId: 7, annualCTC: 660000, monthlyGross: 50000, structureId: 4, effectiveFrom: '2026-11-01',
    })).resolves.toEqual({ id: 10 });

    expect(prisma.employeeSalary.create).toHaveBeenCalledTimes(1);
    expect(prisma.employeeSalary.update).not.toHaveBeenCalled();
    expect(prisma.employeeSalary.updateMany).not.toHaveBeenCalled();
    expect(prisma.employeeSalary.findFirst).toHaveBeenCalledWith({
      where: { employeeId: 7, effectiveFrom: new Date('2026-11-01T00:00:00.000Z') },
      select: { id: true },
    });
  });

  it('rejects a second salary effective from the same date', async () => {
    prisma.employeeSalary.findFirst.mockResolvedValue({ id: 9 });

    await expect(service.assignSalary({ employeeId: 7, annualCTC: 120000, structureId: 3, effectiveFrom: '2026-11-01' }))
      .rejects.toThrow('A salary is already effective from this date');
    expect(prisma.employeeSalary.create).not.toHaveBeenCalled();
  });

  it('rejects a Gross where Basic + HRA + Conveyance would exceed it', async () => {
    prisma.salaryStructure.findUnique.mockResolvedValue(grossStructure);

    // 35% basic + 40% HRA = 49% of gross; 2,000 conveyance does not fit in 3,000
    await expect(service.assignSalary({ employeeId: 7, annualCTC: 36000, monthlyGross: 3000, structureId: 4 }))
      .rejects.toThrow('Basic + HRA + Conveyance cannot exceed Gross salary');
    expect(prisma.employeeSalary.create).not.toHaveBeenCalled();
  });

  it.each([['0'], ['-5'], ['abc']])('rejects an invalid monthlyGross %s', async (monthlyGross) => {
    await expect(service.assignSalary({ employeeId: 7, annualCTC: 120000, monthlyGross, structureId: 3 }))
      .rejects.toThrow('monthlyGross must be a positive number');
  });

  it('rejects an invalid effective date', async () => {
    await expect(service.assignSalary({ employeeId: 7, annualCTC: 120000, structureId: 3, effectiveFrom: 'not-a-date' }))
      .rejects.toThrow('effectiveFrom must be a valid date');
  });

  it('rejects a salary change that would alter a finalized payroll period', async () => {
    prisma.payroll.findFirst.mockResolvedValue({ month: 10, year: 2026 });

    await expect(service.assignSalary({ employeeId: 7, annualCTC: 120000, structureId: 3, effectiveFrom: '2026-10-01' }))
      .rejects.toThrow('Payroll for 10/2026 is finalized');
    expect(prisma.employeeSalary.create).not.toHaveBeenCalled();
  });

  it('marks DRAFT payrolls from the effective payroll period onward as needing recalculation', async () => {
    // 29 Sep belongs to the October payroll period
    await service.assignSalary({ employeeId: 7, annualCTC: 120000, structureId: 3, effectiveFrom: '2026-09-29' });

    const affected = { employeeId: 7, OR: [{ year: { gt: 2026 } }, { year: 2026, month: { gte: 10 } }] };
    expect(prisma.payroll.findFirst).toHaveBeenCalledWith({
      where: { ...affected, status: { in: ['FINALIZED', 'PAID'] } },
      select: { month: true, year: true },
    });
    expect(prisma.payroll.updateMany).toHaveBeenCalledWith({
      where: { ...affected, status: 'DRAFT' },
      data: { needsRecalculation: true },
    });
  });

  it('uses the newest salary structure only when no structure is supplied', async () => {
    await expect(service.assignSalary({
      employeeId: 7,
      annualCTC: 120000,
    })).resolves.toEqual({ id: 10 });
    expect(prisma.salaryStructure.findFirst).toHaveBeenCalledWith({ orderBy: { id: 'desc' } });
    expect(prisma.salaryStructure.findUnique).not.toHaveBeenCalled();
    expect(prisma.employeeSalary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ structureId: 3 }),
    }));
  });

  it('always uses an explicitly selected structure', async () => {
    prisma.salaryStructure.findUnique.mockResolvedValue(grossStructure);

    await service.assignSalary({ employeeId: 7, annualCTC: 660000, monthlyGross: 50000, structureId: 4 });

    expect(prisma.salaryStructure.findUnique).toHaveBeenCalledWith({ where: { id: 4 } });
    expect(prisma.salaryStructure.findFirst).not.toHaveBeenCalled();
    expect(prisma.employeeSalary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ structureId: 4 }),
    }));
  });

  it('rejects an explicitly selected structure that does not exist instead of falling back', async () => {
    prisma.salaryStructure.findUnique.mockResolvedValue(null);

    await expect(service.assignSalary({ employeeId: 7, annualCTC: 120000, structureId: 99 }))
      .rejects.toThrow('Salary structure not found');
    expect(prisma.salaryStructure.findFirst).not.toHaveBeenCalled();
    expect(prisma.employeeSalary.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid structure id', async () => {
    await expect(service.assignSalary({ employeeId: 7, annualCTC: 120000, structureId: 'abc' }))
      .rejects.toThrow('structureId must be a positive integer');
  });

  it('reports when no salary structures are configured', async () => {
    prisma.salaryStructure.findFirst.mockResolvedValue(null);

    await expect(service.assignSalary({
      employeeId: 7,
      annualCTC: 120000,
    })).rejects.toThrow(NotFoundException);
    expect(prisma.employeeSalary.create).not.toHaveBeenCalled();
  });

  it('rejects a Monthly Gross above Monthly CTC', async () => {
    prisma.salaryStructure.findUnique.mockResolvedValue(grossStructure);

    // Monthly CTC = 600,000 / 12 = 50,000
    await expect(service.assignSalary({ employeeId: 7, annualCTC: 600000, monthlyGross: 50001, structureId: 4 }))
      .rejects.toThrow('Monthly Gross cannot exceed Monthly CTC');
    expect(prisma.employeeSalary.create).not.toHaveBeenCalled();
  });

  it('accepts a Monthly Gross equal to Monthly CTC', async () => {
    prisma.salaryStructure.findUnique.mockResolvedValue(grossStructure);

    await expect(service.assignSalary({ employeeId: 7, annualCTC: 600000, monthlyGross: 50000, structureId: 4 }))
      .resolves.toEqual({ id: 10 });
    expect(prisma.employeeSalary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ monthlyCTC: 50000, monthlyGross: 50000 }),
    }));
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

describe('SalaryService structures', () => {
  const prisma = { salaryStructure: { create: jest.fn(), findMany: jest.fn() } } as any;
  const service = new SalaryService(prisma, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('creates a new structure with a fixed conveyance and default PF/PT', async () => {
    prisma.salaryStructure.create.mockResolvedValue({ id: 5 });

    await service.createSalaryStructure({ name: ' Standard ', basicPercent: 35, hraPercent: 40, conveyanceAmount: 2000 });

    expect(prisma.salaryStructure.create).toHaveBeenCalledWith({
      data: { name: 'Standard', basicPercent: 35, hraPercent: 40, conveyancePercent: 0, conveyanceAmount: 2000 },
    });
  });

  it.each([
    [{ basicPercent: 35 }, 'Structure name is required'],
    [{ name: 'X', basicPercent: 120 }, 'between 0 and 100'],
    [{ name: 'X', conveyanceAmount: -1 }, 'conveyanceAmount must be zero or a positive number'],
  ])('rejects invalid structure %j', async (payload, message) => {
    await expect(service.createSalaryStructure(payload as any)).rejects.toThrow(message);
    expect(prisma.salaryStructure.create).not.toHaveBeenCalled();
  });

  it('returns the conveyance amount with the structures', async () => {
    prisma.salaryStructure.findMany.mockResolvedValue([]);
    await service.getSalaryStructures();
    expect(prisma.salaryStructure.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ conveyanceAmount: true, conveyancePercent: true }),
    }));
  });
});
