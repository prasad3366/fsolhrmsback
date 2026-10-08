import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../common/decorators/roles.decorators';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

describe('PayrollService.getPayroll', () => {
  const records = [
    { id: 1, employeeId: 7, status: 'DRAFT', month: 10, year: 2026 },
    { id: 2, employeeId: 8, status: 'FINALIZED', month: 9, year: 2026 },
    { id: 3, employeeId: 9, status: 'PAID', month: 1, year: 2027 },
  ];
  const withPeriods = [
    { ...records[0], period: { startDate: '2026-09-29', endDate: '2026-10-28' } },
    { ...records[1], period: { startDate: '2026-08-29', endDate: '2026-09-28' } },
    { ...records[2], period: { startDate: '2026-12-29', endDate: '2027-01-28' } },
  ];
  const findMany = jest.fn();
  const service = new PayrollService(
    { payroll: { findMany } } as any,
    {} as any,
    {} as any,
    { getWorkingDates: jest.fn() } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue(records);
  });

  it('returns every status when no employee filter is supplied', async () => {
    await expect(service.getPayroll()).resolves.toEqual(withPeriods);
    expect(findMany).toHaveBeenCalledWith({
      include: {
        salary: true,
        employee: { select: { id: true, empCode: true, firstName: true, lastName: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  });

  it('preserves employee-filtered payroll behavior', async () => {
    await expect(service.getPayroll(123)).resolves.toEqual(withPeriods);
    expect(findMany).toHaveBeenCalledWith({
      where: { employeeId: 123 },
      include: {
        salary: true,
        employee: { select: { id: true, empCode: true, firstName: true, lastName: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  });

  it('filters to FINALIZED/PAID at the database level when finalizedOnly is requested', async () => {
    await service.getPayroll(123, { finalizedOnly: true });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { employeeId: 123, status: { in: ['FINALIZED', 'PAID'] } },
    }));
  });
});

describe('PayrollController payroll access', () => {
  const getPayroll = jest.fn();
  const canAccessEmployee = jest.fn();
  const controller = new PayrollController(
    { getPayroll } as any,
    {} as any,
    { canAccessEmployee } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getPayroll.mockResolvedValue([]);
    canAccessEmployee.mockResolvedValue(true);
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s to read all payroll statuses', async (role) => {
    const rows = [
      { id: 1, status: 'DRAFT' },
      { id: 2, status: 'FINALIZED' },
      { id: 3, status: 'PAID' },
    ];
    getPayroll.mockResolvedValue(rows);

    await expect(controller.getPayroll(undefined, { user: { role } } as any)).resolves.toEqual(rows);
    expect(getPayroll).toHaveBeenCalledWith();
  });

  it('preserves FINANCE_MANAGER filtered access but denies unfiltered access', async () => {
    await expect(controller.getPayroll('123', { user: { role: 'FINANCE_MANAGER' } } as any)).resolves.toEqual([]);
    expect(getPayroll).toHaveBeenCalledWith(123);
    expect(() => controller.getPayroll(undefined, { user: { role: 'FINANCE_MANAGER' } } as any))
      .toThrow('Access denied');
  });

  it('denies EMPLOYEE access to the unfiltered management endpoint', () => {
    expect(() => controller.getPayroll(undefined, { user: { role: 'EMPLOYEE' } } as any))
      .toThrow('Access denied');
    expect(getPayroll).not.toHaveBeenCalled();
  });

  it('keeps /payroll/my scoped to the authenticated employee', async () => {
    const rows = [{ id: 1, employeeId: 42 }];
    getPayroll.mockResolvedValue(rows);

    await expect(controller.getMyPayroll({ user: { role: 'EMPLOYEE', employeeId: 42 } } as any))
      .resolves.toEqual(rows);
    expect(canAccessEmployee).toHaveBeenCalledWith({ role: 'EMPLOYEE', employeeId: 42 }, 42);
    // EMPLOYEE gets only FINALIZED/PAID payroll from the backend
    expect(getPayroll).toHaveBeenCalledWith(42, { finalizedOnly: true });
  });

  it.each(['FINANCE_MANAGER', 'HR'])('keeps existing /payroll/my behavior for %s (no status filter)', async (role) => {
    getPayroll.mockResolvedValue([]);
    await controller.getMyPayroll({ user: { role, employeeId: 42 } } as any);
    expect(getPayroll).toHaveBeenCalledWith(42, { finalizedOnly: false });
  });

  it('keeps management GET restricted to its existing roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PayrollController.prototype.getPayroll)).toEqual([
      'SUPER_ADMIN',
      'CEO',
      'HR',
      'FINANCE_MANAGER',
    ]);
  });
});

describe('PayrollController payslip and correction routes', () => {
  const getPayrollById = jest.fn();
  const canAccessEmployee = jest.fn();
  const generatePayslip = jest.fn();
  const previewRecalculation = jest.fn();
  const reopenPayroll = jest.fn();
  const controller = new PayrollController(
    { getPayrollById, previewRecalculation, reopenPayroll } as any,
    { generatePayslip } as any,
    { canAccessEmployee } as any,
  );
  const response = {} as any;
  const employeeRequest = { user: { id: 42, role: 'EMPLOYEE', employeeId: 42 } } as any;

  beforeEach(() => jest.clearAllMocks());

  it.each(['abc', '1.5', '0', '-3'])('rejects payslip id %s with 400 before any lookup', async (id) => {
    await expect(controller.downloadPayslip(id as any, response, employeeRequest)).rejects.toThrow(
      BadRequestException,
    );
    expect(getPayrollById).not.toHaveBeenCalled();
    expect(generatePayslip).not.toHaveBeenCalled();
  });

  it("denies an employee another employee's payslip", async () => {
    getPayrollById.mockResolvedValue({ id: 9, employeeId: 77 });
    canAccessEmployee.mockResolvedValue(false);

    await expect(controller.downloadPayslip('9' as any, response, employeeRequest)).rejects.toThrow('Access denied');
    expect(canAccessEmployee).toHaveBeenCalledWith(employeeRequest.user, 77);
    expect(generatePayslip).not.toHaveBeenCalled();
  });

  it('serves an employee their own payslip', async () => {
    getPayrollById.mockResolvedValue({ id: 9, employeeId: 42 });
    canAccessEmployee.mockResolvedValue(true);

    await controller.downloadPayslip('9' as any, response, employeeRequest);
    expect(generatePayslip).toHaveBeenCalledWith(9, response);
  });

  it('passes the reopen reason and actor to the service', async () => {
    const hrRequest = { user: { id: 1, role: 'HR', employeeId: 1 } } as any;
    await controller.reopenPayroll('5' as any, { reason: 'Correction' }, hrRequest);
    expect(reopenPayroll).toHaveBeenCalledWith(5, 'Correction', hrRequest.user);
  });

  it('rejects an invalid id on preview', () => {
    expect(() => controller.previewRecalculation('x' as any)).toThrow(BadRequestException);
    expect(previewRecalculation).not.toHaveBeenCalled();
  });

  it.each(['previewRecalculation', 'reopenPayroll'])('limits %s to HR, CEO, and SUPER_ADMIN', (method) => {
    expect(Reflect.getMetadata(ROLES_KEY, (PayrollController.prototype as any)[method])).toEqual([
      'SUPER_ADMIN',
      'CEO',
      'HR',
    ]);
  });
});

describe('PayrollService.recalculatePayroll', () => {
  const salary = {
    id: 2,
    monthlyCTC: 60000,
    structure: {
      basicPercent: 50,
      hraPercent: 40,
      conveyancePercent: 10,
      pfPercent: 12,
      ptAmount: 200,
    },
  };
  const existingPayroll = {
    id: 3,
    employeeId: 7,
    salaryId: 1,
    month: 9,
    year: 2026,
    status: 'DRAFT',
    otherAllowance: 1000,
    otherDeduction: 300,
    others: [
      { type: 'ALLOWANCE', amount: 1000 },
      { type: 'DEDUCTION', amount: 300 },
    ],
  };

  const createService = (status = 'DRAFT') => {
    const payroll = {
      ...existingPayroll,
      status,
      presentDays: 15,
      workingDays: 21,
      lopDays: 6,
      leaveDeduction: 17143,
    };
    const prisma = {
      payroll: {
        findUnique: jest.fn().mockResolvedValue(payroll),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 3, ...data })),
        create: jest.fn(),
      },
      employeeSalary: { findFirst: jest.fn().mockResolvedValue(salary) },
      employee: { findUnique: jest.fn().mockResolvedValue({ userId: 70 }) },
      leave: { aggregate: jest.fn().mockResolvedValue({ _sum: { paidLeaveDays: 0, lopDays: 0 } }) },
      auditLog: { create: jest.fn() },
    } as any;
    prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
    const workingDates = Array.from({ length: 21 }, (_, index) =>
      new Date(Date.UTC(2026, 8, index + 1)),
    );
    const workingDaysService = { getWorkingDates: jest.fn().mockResolvedValue(workingDates) } as any;
    const service = new PayrollService(prisma, {} as any, {} as any, workingDaysService);
    const attendanceHistory = jest.spyOn(
      (service as any).attendanceService,
      'getAttendanceHistoryForDateRange',
    ).mockResolvedValue(workingDates.map((date) => ({ date, status: 'PRESENT' })));

    return { service, prisma, workingDaysService, attendanceHistory };
  };

  it('updates the same draft row from corrected attendance and preserves adjustments', async () => {
    const { service, prisma, workingDaysService, attendanceHistory } = createService();

    const result = await service.recalculatePayroll(3);

    expect(prisma.payroll.update).toHaveBeenCalledWith({
      where: { id: 3, status: 'DRAFT' },
      data: expect.objectContaining({
        presentDays: 21,
        workingDays: 21,
        lopDays: 0,
        leaveDeduction: 0,
        otherAllowance: 1000,
        otherDeduction: 300,
        deductions: 4100,
        netSalary: 56900,
        needsRecalculation: false,
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'PAYROLL_RECALCULATED', module: 'PAYROLL' }),
    });
    expect(prisma.payroll.create).not.toHaveBeenCalled();
    expect(attendanceHistory).toHaveBeenCalledWith(
      70,
      7,
      new Date('2026-08-29T00:00:00.000Z'),
      new Date('2026-09-29T00:00:00.000Z'),
    );
    expect(workingDaysService.getWorkingDates.mock.calls[0][1]).toHaveLength(31);
    expect(result.id).toBe(3);
  });

  it.each(['FINALIZED', 'PAID'])('does not recalculate %s payroll', async (status) => {
    const { service, prisma, attendanceHistory } = createService(status);

    await expect(service.recalculatePayroll(3)).rejects.toThrow('Only draft payroll can be recalculated');

    expect(prisma.payroll.update).not.toHaveBeenCalled();
    expect(attendanceHistory).not.toHaveBeenCalled();
  });

  it.each(['FINALIZED', 'PAID'])('does not allow generic updates to %s payroll', async (status) => {
    const { service, prisma } = createService(status);

    await expect(service.updatePayroll(3, { lopDays: 0 })).rejects.toThrow(
      'Payroll is finalized and cannot be modified',
    );
    expect(prisma.payroll.update).not.toHaveBeenCalled();
  });

  it('limits recalculation to HR, CEO, and SUPER_ADMIN roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PayrollController.prototype.recalculatePayroll)).toEqual([
      'SUPER_ADMIN',
      'CEO',
      'HR',
    ]);
  });
});

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
      employee: { findUnique: jest.fn().mockResolvedValue({ userId: 70 }) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
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
      otherAllowance: 0,
      otherDeduction: 0,
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
        otherAllowance: { increment: 200 },
        otherDeduction: 0,
        grossSalary: 1200,
        deductions: 100,
        netSalary: 1100,
      },
    });
  });

  it('updates the persisted deduction component and net total', async () => {
    prisma.payroll.findUnique.mockResolvedValue({
      id: 1,
      grossSalary: 1000,
      deductions: 100,
      netSalary: 900,
      otherAllowance: 0,
      otherDeduction: 0,
      status: 'DRAFT',
    });
    prisma.payrollAdjustment.create.mockResolvedValue({});
    prisma.payroll.update.mockResolvedValue({ id: 1, grossSalary: 1000, deductions: 300, netSalary: 700 });

    await expect(service.addOther(1, 'Advance recovery', 'DEDUCTION', 200)).resolves.toEqual({
      id: 1,
      grossSalary: 1000,
      deductions: 300,
      netSalary: 700,
    });

    expect(prisma.payroll.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        otherAllowance: { increment: 0 },
        otherDeduction: 200,
        grossSalary: 1000,
        deductions: 300,
        netSalary: 700,
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

  it('finalizes a draft payroll explicitly', async () => {
    prisma.payroll.findUnique.mockResolvedValue({ id: 1, status: 'DRAFT' });
    prisma.payroll.update.mockResolvedValue({ id: 1, status: 'FINALIZED' });

    await expect(service.finalizePayroll(1)).resolves.toEqual({ id: 1, status: 'FINALIZED' });
    expect(prisma.payroll.update).toHaveBeenCalledWith({
      where: { id: 1, status: 'DRAFT', needsRecalculation: false },
      data: { status: 'FINALIZED' },
    });
  });

  it('does not finalize paid payroll', async () => {
    prisma.payroll.findUnique.mockResolvedValue({ id: 1, status: 'PAID' });

    await expect(service.finalizePayroll(1)).rejects.toThrow(BadRequestException);
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
