import { BadRequestException, ConflictException } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { PayrollService } from './payroll.service';
import { PayslipService } from './payslip.service';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));

/* Payrolls adjusted by earlier versions of addOther:
   E0 - PayrollAdjustment row only, totals never changed
   E1 - totals only (grossSalary / deductions), no row, no component columns
   E2 - row + totals, otherAllowance / otherDeduction not updated
   E3 - current: row + totals + otherAllowance / otherDeduction
   Rows created before the component columns were populated have conveyance
   and otherDeduction NULL. Salary: 60000 CTC, full attendance, so the
   calculated payroll is gross 60000, PF 3600, PT 200, no LOP. */

const SALARY = {
  id: 2,
  monthlyCTC: 60000,
  structure: { basicPercent: 50, hraPercent: 40, conveyancePercent: 10, pfPercent: 12, ptAmount: 200 },
};

const legacyRow = (overrides: Record<string, any> = {}) => ({
  id: 3,
  employeeId: 7,
  salaryId: 2,
  month: 9,
  year: 2026,
  status: 'DRAFT',
  revision: 0,
  needsRecalculation: false,
  workingDays: 21,
  presentDays: 21,
  lopDays: 0,
  paidLeaveDays: null,
  basic: 30000,
  hra: 12000,
  conveyance: null,
  specialAllowance: 12000,
  otherAllowance: 0,
  pf: 3600,
  pt: 200,
  leaveDeduction: 0,
  otherDeduction: null,
  grossSalary: 60000,
  deductions: 3800,
  netSalary: 56200,
  others: [] as any[],
  ...overrides,
});

const adjustment = (type: 'ALLOWANCE' | 'DEDUCTION', amount: number, name = type === 'ALLOWANCE' ? 'Bonus' : 'Advance') =>
  ({ id: Math.round(amount) + (type === 'ALLOWANCE' ? 1 : 2), payrollId: 3, name, type, amount });

const createService = (row: any, salaries: any[] = [SALARY]) => {
  const state = { row: { ...row } };
  const prisma: any = {
    payroll: {
      findUnique: jest.fn(async () => ({ ...state.row })),
      update: jest.fn(async ({ data }: any) => {
        const { revision, ...rest } = data;
        state.row = { ...state.row, ...rest, revision: revision?.increment ? state.row.revision + revision.increment : state.row.revision };
        return { ...state.row };
      }),
      create: jest.fn(),
    },
    employeeSalary: {
      findFirst: jest.fn(async () => salaries[0]),
      findUnique: jest.fn(async ({ where }: any) => salaries.find((salary) => salary.id === where.id) ?? null),
    },
    employee: { findUnique: jest.fn(async () => ({ userId: 70 })) },
    auditLog: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));

  const workingDates = Array.from({ length: 21 }, (_, index) => new Date(Date.UTC(2026, 8, index + 1)));
  const service = new PayrollService(prisma, {} as any, {} as any, {
    getWorkingDates: jest.fn().mockResolvedValue(workingDates),
  } as any);
  jest.spyOn((service as any).attendanceService, 'getAttendanceHistoryForDateRange')
    .mockResolvedValue(workingDates.map((date) => ({ date, status: 'PRESENT' })));

  return { service, prisma, state };
};

const issueCodes = (preview: any) => preview.historicalAdjustments.issues.map((issue: any) => [issue.code, issue.blocking, issue.amount]);

describe('Payroll recalculation - historical adjustments', () => {
  it('1. E1 deduction stored only in totals is carried forward', async () => {
    const { service, prisma } = createService(legacyRow({ deductions: 4300, netSalary: 55700 }));

    const preview = await service.previewRecalculation(3);
    const result = await service.recalculatePayroll(3);

    expect(issueCodes(preview)).toEqual([['LEGACY_DEDUCTION_CARRIED', false, 500]]);
    expect(result).toEqual(expect.objectContaining({ otherDeduction: 500, deductions: 4300, grossSalary: 60000, netSalary: 55700 }));
    expect(prisma.payroll.update).toHaveBeenCalledTimes(1);
  });

  it('2. E1 allowance stored only in gross blocks recalculation with an actionable error', async () => {
    const { service, prisma } = createService(legacyRow({ grossSalary: 61000, netSalary: 57200 }));

    const preview = await service.previewRecalculation(3);

    expect(issueCodes(preview)).toEqual([['UNEXPLAINED_LEGACY_GROSS', true, 1000]]);
    expect(preview.historicalAdjustments.blocksRecalculation).toBe(true);
    await expect(service.recalculatePayroll(3)).rejects.toThrow(BadRequestException);
    await expect(service.recalculatePayroll(3)).rejects.toThrow(
      /includes 1000 that no allowance record explains.*Recalculation stays blocked until the amount is confirmed and recorded.*authorized payroll data-reconciliation process.*Do not re-enter it with \+ Adjust/,
    );
    await expect(service.recalculatePayroll(3)).rejects.not.toThrow(/recalculate, then re-enter/i);
    expect(prisma.payroll.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('3. E2 allowance recorded as a row is carried, and its payslip has no negative line', async () => {
    const { service, state } = createService(legacyRow({
      grossSalary: 61000, netSalary: 57200, others: [adjustment('ALLOWANCE', 1000)],
    }));

    const preview = await service.previewRecalculation(3);
    const result = await service.recalculatePayroll(3);

    expect(issueCodes(preview)).toEqual([['LEGACY_ALLOWANCE_RECORDS_CARRIED', false, 1000]]);
    expect(result).toEqual(expect.objectContaining({ otherAllowance: 1000, grossSalary: 61000, netSalary: 57200 }));

    const html = await renderPayslip({ ...state.row, status: 'FINALIZED', others: [adjustment('ALLOWANCE', 1000)] });
    expect(html).toMatch(/Bonus<\/td><td class="amount">₹1,000\.00/);
    expect(html).not.toContain('Other allowance');
    expect(html).not.toContain('-₹');
  });

  it('4. E2 deduction recorded as a row is carried once, not double-counted', async () => {
    const { service } = createService(legacyRow({
      deductions: 4300, netSalary: 55700, others: [adjustment('DEDUCTION', 500)],
    }));

    const preview = await service.previewRecalculation(3);
    const result = await service.recalculatePayroll(3);

    expect(issueCodes(preview)).toEqual([]);
    expect(result).toEqual(expect.objectContaining({ otherDeduction: 500, deductions: 4300, netSalary: 55700 }));
  });

  it.each([
    ['deduction', { others: [adjustment('DEDUCTION', 500)] }, 'DEDUCTION_RECORDS_MISMATCH', 500],
    ['allowance', { others: [adjustment('ALLOWANCE', 1000)] }, 'UNEXPLAINED_LEGACY_GROSS', -1000],
  ])('5. E0 %s row whose amount was never applied blocks recalculation', async (_name, overrides, code, amount) => {
    const { service, prisma } = createService(legacyRow(overrides));

    const preview = await service.previewRecalculation(3);

    expect(issueCodes(preview)).toEqual([[code, true, code === 'DEDUCTION_RECORDS_MISMATCH' ? -amount : amount]]);
    await expect(service.recalculatePayroll(3)).rejects.toThrow('Payroll cannot be recalculated safely');
    expect(prisma.payroll.update).not.toHaveBeenCalled();
  });

  it('6. E1/E2 adjustments followed by E3 adjustments are each kept exactly once', async () => {
    // E2 allowance 1000 (row only) + E3 allowance 500; E1 deduction 300 + E3 deduction 200
    const { service } = createService(legacyRow({
      otherAllowance: 500,
      otherDeduction: 500,
      grossSalary: 61500,
      deductions: 4300,
      netSalary: 57200,
      others: [adjustment('ALLOWANCE', 1000), adjustment('ALLOWANCE', 500, 'Shift'), adjustment('DEDUCTION', 200)],
    }));

    const result = await service.recalculatePayroll(3);

    expect(result).toEqual(expect.objectContaining({
      otherAllowance: 1500, grossSalary: 61500, otherDeduction: 500, deductions: 4300, netSalary: 57200,
    }));
  });

  it.each([
    ['deductions one above components', { deductions: 3801, netSalary: 56199 }],
    ['deductions one below components', { deductions: 3799, netSalary: 56201 }],
    ['gross one above salary', { grossSalary: 60001, netSalary: 56201 }],
  ])('7. old rounding (%s) is not treated as an adjustment', async (_name, overrides) => {
    const { service } = createService(legacyRow(overrides));

    const preview = await service.previewRecalculation(3);
    const result = await service.recalculatePayroll(3);

    expect(issueCodes(preview)).toEqual([]);
    expect(result).toEqual(expect.objectContaining({ otherAllowance: 0, otherDeduction: 0, grossSalary: 60000, deductions: 3800 }));
  });

  it.each([
    ['E1 deduction', legacyRow({ deductions: 4300, netSalary: 55700 })],
    ['E2 allowance', legacyRow({ grossSalary: 61000, netSalary: 57200, others: [adjustment('ALLOWANCE', 1000)] })],
    ['E2 deduction', legacyRow({ deductions: 4300, netSalary: 55700, others: [adjustment('DEDUCTION', 500)] })],
    ['E3 current', legacyRow({ conveyance: 6000, otherAllowance: 1000, otherDeduction: 300, grossSalary: 61000, deductions: 4100, netSalary: 56900,
      others: [adjustment('ALLOWANCE', 1000), adjustment('DEDUCTION', 300)] })],
  ])('8. preview and recalculation produce identical figures (%s)', async (_name, row) => {
    const { service } = createService(row);

    const preview = await service.previewRecalculation(3);
    const result = await service.recalculatePayroll(3);

    for (const [field, value] of Object.entries(preview.recalculated)) {
      expect([field, result[field as keyof typeof result]]).toEqual([field, value]);
    }
  });

  it('9. current (E3) payrolls keep their stored adjustments unchanged', async () => {
    const { service } = createService(legacyRow({
      conveyance: 6000, otherAllowance: 1000, otherDeduction: 300, grossSalary: 61000, deductions: 4100, netSalary: 56900,
      others: [adjustment('ALLOWANCE', 1000), adjustment('DEDUCTION', 300)],
    }));

    const preview = await service.previewRecalculation(3);
    const result = await service.recalculatePayroll(3);

    expect(preview.historicalAdjustments).toEqual(expect.objectContaining({ legacyRecord: false, issues: [], blocksRecalculation: false }));
    expect(result).toEqual(expect.objectContaining({ otherAllowance: 1000, otherDeduction: 300, grossSalary: 61000, deductions: 4100, netSalary: 56900 }));
  });

  it('9b. a current payroll whose rows exceed its allowance keeps the stored amount and is flagged', async () => {
    const { service } = createService(legacyRow({
      conveyance: 6000, otherAllowance: 0, otherDeduction: 0, others: [adjustment('ALLOWANCE', 1000)],
    }));

    const preview = await service.previewRecalculation(3);
    const result = await service.recalculatePayroll(3);

    expect(issueCodes(preview)).toEqual([['ALLOWANCE_RECORDS_NOT_REFLECTED', false, 1000]]);
    expect(result).toEqual(expect.objectContaining({ otherAllowance: 0, grossSalary: 60000 }));
  });

  it('10. a reopened FINALIZED payroll gets the same protection', async () => {
    const actor = { id: 1, email: 'hr@example.com', role: 'HR' } as any;
    const allowance = createService(legacyRow({ status: 'FINALIZED', grossSalary: 61000, netSalary: 57200 }));
    const deduction = createService(legacyRow({ status: 'FINALIZED', deductions: 4300, netSalary: 55700 }));

    await allowance.service.reopenPayroll(3, 'Attendance correction', actor);
    await deduction.service.reopenPayroll(3, 'Attendance correction', actor);

    expect(allowance.state.row).toEqual(expect.objectContaining({ status: 'DRAFT', revision: 1, needsRecalculation: true }));
    await expect(allowance.service.recalculatePayroll(3, actor)).rejects.toThrow(/includes 1000 that no allowance record explains/);
    expect(allowance.state.row).toEqual(expect.objectContaining({ grossSalary: 61000, needsRecalculation: true }));

    await expect(deduction.service.recalculatePayroll(3, actor)).resolves.toEqual(expect.objectContaining({
      otherDeduction: 500, deductions: 4300, netSalary: 55700, needsRecalculation: false,
    }));
  });

  it('checks a legacy payroll against the salary it was calculated on, not a later one', async () => {
    const raised = { ...SALARY, id: 5, monthlyCTC: 70000 };
    const { service, prisma } = createService(legacyRow({ deductions: 4300, netSalary: 55700 }), [raised, SALARY]);

    const preview = await service.previewRecalculation(3);

    expect(prisma.employeeSalary.findUnique).toHaveBeenCalledWith({ where: { id: 2 } });
    expect(issueCodes(preview)).toEqual([['LEGACY_DEDUCTION_CARRIED', false, 500]]);
  });

  it('blocks a legacy payroll whose salary record no longer exists', async () => {
    const { service } = createService(legacyRow(), [{ ...SALARY, id: 5 }]);

    const preview = await service.previewRecalculation(3);

    expect(issueCodes(preview)).toEqual([['LEGACY_SALARY_MISSING', true, 0]]);
    await expect(service.recalculatePayroll(3)).rejects.toThrow('Payroll cannot be recalculated safely');
  });
});

describe('Payslip - adjustment rows the payroll never applied', () => {
  it('refuses a payslip instead of printing a negative allowance line', async () => {
    // Legacy E2 payroll finalized before recalculation: the row is in gross but not in otherAllowance
    const row = legacyRow({
      status: 'FINALIZED', conveyance: 6000, specialAllowance: 13000, grossSalary: 61000, netSalary: 57200,
      otherDeduction: 0, others: [adjustment('ALLOWANCE', 1000)],
    });

    await expect(renderPayslip(row)).rejects.toThrow(ConflictException);
    await expect(renderPayslip(row)).rejects.toThrow(/Recorded allowance adjustments exceed the amount stored on this payroll/);
  });

  // Legacy E2 deduction of 500: the old calculator rounded the total once, so the
  // stored residual (deductions - PF - PT - leave deduction) can be off by its rounding
  const legacyDeductionPayslip = (status: string, storedResidual: number) => legacyRow({
    status,
    otherDeduction: null,
    deductions: 3800 + storedResidual,
    netSalary: 60000 - (3800 + storedResidual),
    others: [adjustment('DEDUCTION', 500)],
  });

  it.each(['FINALIZED', 'PAID'])('issues a %s legacy payslip whose deduction record differs from the stored residual by old rounding (1)', async (status) => {
    const html = await renderPayslip(legacyDeductionPayslip(status, 499));

    expect(html).toMatch(/Advance<\/td><td class="amount">₹500\.00/);
    expect(html).toContain('55,701.00');
    // The old rounding stays visible as the reconciling line, as before
    expect(html).toMatch(/Other deductions<\/td><td class="amount">-₹1\.00/);
  });

  it.each(['FINALIZED', 'PAID'])('refuses a %s legacy payslip whose deduction record exceeds the stored residual by more than rounding (3)', async (status) => {
    await expect(renderPayslip(legacyDeductionPayslip(status, 497)))
      .rejects.toThrow(/Recorded deduction adjustments exceed the amount stored on this payroll by ₹3\.00/);
  });

  it('keeps the strict check when the deduction total is stored (current format)', async () => {
    const row = legacyRow({
      status: 'FINALIZED', conveyance: 6000, otherDeduction: 499, deductions: 4299, netSalary: 55701,
      others: [adjustment('DEDUCTION', 500)],
    });

    await expect(renderPayslip(row)).rejects.toThrow(/Recorded deduction adjustments exceed the amount stored on this payroll by ₹1\.00/);
  });
});

async function renderPayslip(row: any) {
  const page = { setContent: jest.fn(), pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
  (puppeteer.launch as jest.Mock).mockResolvedValue({ newPage: jest.fn().mockResolvedValue(page), close: jest.fn() });
  const prisma: any = {
    payroll: {
      findUnique: jest.fn().mockResolvedValue({
        ...row,
        needsRecalculation: false,
        employee: { empCode: 'EMP7', firstName: 'Test', lastName: 'Employee', dateOfJoining: new Date('2024-01-01T00:00:00Z') },
      }),
    },
    systemSetting: { findUnique: jest.fn().mockResolvedValue({ companyName: 'Co', companyAddress: 'Addr', currency: 'INR', timeZone: 'Asia/Kolkata' }) },
  };
  await new PayslipService(prisma).generatePayslip(row.id, { setHeader: jest.fn(), send: jest.fn() } as any);
  return page.setContent.mock.calls[0][0] as string;
}
