import * as puppeteer from 'puppeteer';
import { AttendanceService } from '../attendance/attendance.service';
import { HolidaysService } from '../holidays/holidays.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { PayrollService } from './payroll.service';
import { PayslipService } from './payslip.service';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));

/* ------------------------------------------------------------------
   Minimal in-memory Prisma covering the query shapes used by the real
   AttendanceService, PayrollService, PayslipService, HolidaysService
   and WorkingDaysService in this flow.
   ------------------------------------------------------------------ */

type Row = Record<string, any>;

const comparable = (value: any) => (value instanceof Date ? value.getTime() : value);

const matchesValue = (actual: any, expected: any): boolean => {
  if (expected === null) return actual === null || actual === undefined;
  if (expected instanceof Date) return comparable(actual) === expected.getTime();
  if (typeof expected === 'object' && !Array.isArray(expected)) {
    return Object.entries(expected).every(([operator, operand]) => {
      const left = comparable(actual);
      const right = comparable(operand);
      switch (operator) {
        case 'equals': return matchesValue(actual, operand);
        case 'in': return (operand as any[]).some((item) => matchesValue(actual, item));
        case 'not': return !matchesValue(actual, operand);
        case 'lt': return left < right;
        case 'lte': return left <= right;
        case 'gt': return left > right;
        case 'gte': return left >= right;
        default: throw new Error(`Unsupported operator ${operator}`);
      }
    });
  }
  return actual === expected;
};

const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return (expected as Row[]).some((clause) => matches(row, clause));
    if (key === 'AND') return (expected as Row[]).every((clause) => matches(row, clause));
    if (key === 'userId_date') {
      return row.userId === expected.userId && comparable(row.date) === comparable(expected.date);
    }
    if (expected === undefined) return true;
    return matchesValue(row[key], expected);
  });

const sortRows = (rows: Row[], orderBy?: Row | Row[]) => {
  const orders = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const [field, direction] = Object.entries(order)[0];
      const left = comparable(a[field]);
      const right = comparable(b[field]);
      if (left < right) return direction === 'asc' ? -1 : 1;
      if (left > right) return direction === 'asc' ? 1 : -1;
    }
    return 0;
  });
};

const createInMemoryPrisma = () => {
  const tables: Record<string, Row[]> = {
    user: [], team: [], employee: [], employeeSalary: [], payroll: [], payrollAdjustment: [],
    attendanceRecord: [], leave: [], holiday: [], auditLog: [], systemSetting: [],
    attendanceRegularization: [],
  };
  const ids: Record<string, number> = {};
  const defaults: Record<string, () => Row> = {
    payroll: () => ({ status: 'DRAFT', needsRecalculation: false, revision: 0, createdAt: new Date() }),
    attendanceRegularization: () => ({ status: 'PENDING', createdAt: new Date() }),
  };
  const relations: Record<string, Record<string, (row: Row) => any>> = {
    employee: {
      team: (row) => tables.team.find((team) => team.id === row.teamId) ?? null,
      user: (row) => tables.user.find((user) => user.id === row.userId) ?? null,
    },
    payroll: {
      employee: (row) => tables.employee.find((employee) => employee.id === row.employeeId) ?? null,
      others: (row) => tables.payrollAdjustment.filter((adjustment) => adjustment.payrollId === row.id),
    },
    employeeSalary: {
      structure: (row) => row.structure,
    },
  };

  const project = (model: string, row: Row | undefined, args: Row = {}) => {
    if (!row) return null;
    const result: Row = { ...row };
    const spec = args.include ?? args.select ?? {};
    for (const key of Object.keys(spec)) {
      const relation = relations[model]?.[key];
      if (relation) result[key] = relation(row);
    }
    return result;
  };

  const applyData = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && !(value instanceof Date) && 'increment' in value) {
        row[key] = Number(row[key] ?? 0) + Number(value.increment);
      } else if (value !== undefined) {
        row[key] = value;
      }
    }
  };

  const notFound = () => Object.assign(new Error('Record not found'), { code: 'P2025' });

  const delegate = (model: string) => ({
    findUnique: jest.fn(async (args: Row) => project(model, tables[model].find((row) => matches(row, args.where)), args)),
    findFirst: jest.fn(async (args: Row = {}) =>
      project(model, sortRows(tables[model].filter((row) => matches(row, args.where)), args.orderBy)[0], args)),
    findMany: jest.fn(async (args: Row = {}) =>
      sortRows(tables[model].filter((row) => matches(row, args.where)), args.orderBy).map((row) => project(model, row, args))),
    create: jest.fn(async (args: Row) => {
      ids[model] = (ids[model] ?? 0) + 1;
      const row = { id: ids[model], ...(defaults[model]?.() ?? {}), ...args.data };
      tables[model].push(row);
      return { ...row };
    }),
    update: jest.fn(async (args: Row) => {
      const row = tables[model].find((candidate) => matches(candidate, args.where));
      if (!row) throw notFound();
      applyData(row, args.data);
      return project(model, row, args);
    }),
    updateMany: jest.fn(async (args: Row) => {
      const rows = tables[model].filter((row) => matches(row, args.where));
      rows.forEach((row) => applyData(row, args.data));
      return { count: rows.length };
    }),
    delete: jest.fn(async (args: Row) => {
      const index = tables[model].findIndex((row) => matches(row, args.where));
      if (index < 0) throw notFound();
      return tables[model].splice(index, 1)[0];
    }),
  });

  const prisma: any = { tables };
  for (const model of Object.keys(tables)) prisma[model] = delegate(model);
  prisma.attendancePolicy = {
    upsert: jest.fn(async () => ({ shiftStartTime: '09:00', shiftEndTime: '18:00', gracePeriodMins: 15, earlyCheckoutMins: 30 })),
  };
  prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
  return prisma;
};

/* ------------------------------------------------------------------ */

const EMPLOYEE_ID = 7;
const USER_ID = 70;
const hrActor = { id: 1, role: 'HR', email: 'hr@example.com', employeeId: 1 } as any;

const businessDate = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};
const keyOf = (date: Date) => date.toISOString().slice(0, 10);

/* Weekdays (Mon-Fri) from start through end, inclusive */
const weekdaysBetween = (startKey: string, endKey: string) => {
  const keys: string[] = [];
  for (let time = businessDate(startKey).getTime(); time <= businessDate(endKey).getTime(); time += 86400000) {
    const day = new Date(time).getUTCDay();
    if (day !== 0 && day !== 6) keys.push(keyOf(new Date(time)));
  }
  return keys;
};

const SEPTEMBER_WORKING_DAYS = weekdaysBetween('2026-08-29', '2026-09-28');
const OCTOBER_WORKING_DAYS = weekdaysBetween('2026-09-29', '2026-10-28');

/* IST 09:00 -> clock-in, IST punch-out after `hours` */
const punch = (key: string, hours: number | null) => {
  const clockIn = new Date(`${key}T03:30:00.000Z`);
  return {
    clockIn,
    clockOut: hours === null ? null : new Date(clockIn.getTime() + hours * 3600000),
    totalHours: hours ?? 0,
  };
};

const setup = () => {
  const prisma = createInMemoryPrisma();
  prisma.tables.user.push({ id: USER_ID, email: 'asha@example.com', role: 'EMPLOYEE' });
  prisma.tables.employee.push({
    id: EMPLOYEE_ID, userId: USER_ID, status: 'ACTIVE', teamId: null, empCode: 'EMP007',
    firstName: 'Asha', lastName: 'Rao', department: 'IT', designation: 'Engineer',
    dateOfJoining: new Date('2024-01-15T00:00:00.000Z'),
  });
  prisma.tables.employeeSalary.push({
    id: 2, employeeId: EMPLOYEE_ID, monthlyCTC: 60000, annualCTC: 720000,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    structure: { basicPercent: 50, hraPercent: 40, conveyancePercent: 10, pfPercent: 12, ptAmount: 200 },
  });

  const holidaysService = new HolidaysService(prisma);
  const workingDaysService = new WorkingDaysService(prisma, holidaysService);
  const authorizationService = { canAccessOrganizationWide: jest.fn().mockReturnValue(true) } as any;
  const attendanceService = new AttendanceService(prisma, holidaysService, authorizationService, workingDaysService);
  const payrollService = new PayrollService(prisma, {} as any, {} as any, workingDaysService);
  const payslipService = new PayslipService(prisma);

  const addAttendance = (key: string, hours: number | null) => {
    prisma.tables.attendanceRecord.push({
      id: prisma.tables.attendanceRecord.length + 1000,
      userId: USER_ID,
      userEmail: 'asha@example.com',
      date: businessDate(key),
      status: hours === null ? 'IN_PROGRESS' : 'PRESENT',
      ...punch(key, hours),
    });
  };
  const addLeave = (leave: Row) => {
    prisma.tables.leave.push({
      id: prisma.tables.leave.length + 500,
      employeeId: EMPLOYEE_ID,
      status: 'APPROVED',
      durationType: 'FULL_DAY',
      ...leave,
      startDate: businessDate(leave.startDate),
      endDate: businessDate(leave.endDate),
    });
  };

  const renderPayslip = async (payrollId: number) => {
    const page = { setContent: jest.fn(), pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    (puppeteer.launch as jest.Mock).mockResolvedValue({ newPage: jest.fn().mockResolvedValue(page), close: jest.fn() });
    const response = { setHeader: jest.fn(), send: jest.fn() } as any;
    await payslipService.generatePayslip(payrollId, response);
    return page.setContent.mock.calls[0][0] as string;
  };

  const payrollRow = (id: number) => prisma.tables.payroll.find((row: Row) => row.id === id);
  const auditActions = () => prisma.tables.auditLog.map((log: Row) => log.action);

  return {
    prisma, attendanceService, payrollService, holidaysService,
    addAttendance, addLeave, renderPayslip, payrollRow, auditActions,
  };
};

/* A working day with no attendance record at all (genuinely absent until HR corrects it) */
const ABSENT_DAY = '2026-09-15';
const missedPunchOut = { employeeId: EMPLOYEE_ID, date: ABSENT_DAY, clockIn: '2026-09-15T03:30:00.000Z', clockOut: '2026-09-15T12:30:00.000Z', reason: 'Missed attendance' };

describe('Payroll correction flow (integration)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('absent day -> LOP -> missed attendance -> stale -> preview -> recalculate -> finalize -> corrected payslip', async () => {
    const ctx = setup();
    expect(SEPTEMBER_WORKING_DAYS).toHaveLength(21);
    SEPTEMBER_WORKING_DAYS.forEach((key) => { if (key !== ABSENT_DAY) ctx.addAttendance(key, 9); });

    const payroll = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);
    expect(payroll).toEqual(expect.objectContaining({
      workingDays: 21, presentDays: 20, lopDays: 1, leaveDeduction: 2857, deductions: 6657, netSalary: 53343,
    }));
    await expect(ctx.payrollService.previewRecalculation(payroll.id)).resolves.toEqual(
      expect.objectContaining({ differences: [] }),
    );

    await ctx.attendanceService.addMissedAttendance(missedPunchOut, hrActor);
    expect(ctx.payrollRow(payroll.id).needsRecalculation).toBe(true);
    await expect(ctx.payrollService.finalizePayroll(payroll.id, hrActor)).rejects.toThrow('Recalculate it before finalizing');

    const writesBefore = ctx.prisma.payroll.update.mock.calls.length + ctx.prisma.auditLog.create.mock.calls.length;
    const preview = await ctx.payrollService.previewRecalculation(payroll.id);
    expect(ctx.prisma.payroll.update.mock.calls.length + ctx.prisma.auditLog.create.mock.calls.length).toBe(writesBefore);
    expect(preview.period).toEqual({ startDate: '2026-08-29', endDate: '2026-09-28' });
    expect(Object.fromEntries(preview.differences.map((diff: any) => [diff.field, diff.delta]))).toEqual({
      presentDays: 1, lopDays: -1, leaveDeduction: -2857, deductions: -2857, netSalary: 2857,
    });

    const recalculated = await ctx.payrollService.recalculatePayroll(payroll.id, hrActor);
    expect(recalculated).toEqual(expect.objectContaining({
      presentDays: 21, lopDays: 0, leaveDeduction: 0, deductions: 3800, netSalary: 56200, needsRecalculation: false,
    }));

    await ctx.payrollService.finalizePayroll(payroll.id, hrActor);
    expect(ctx.payrollRow(payroll.id).status).toBe('FINALIZED');
    expect(ctx.auditActions()).toEqual(['MISSED_ATTENDANCE_ADDED', 'PAYROLL_RECALCULATED', 'PAYROLL_FINALIZED']);

    const html = await ctx.renderPayslip(payroll.id);
    expect(html).toContain('56,200.00');
    expect(html).not.toContain('53,343.00');
    expect(html).toMatch(/Period dates: 29 Aug 2026 - 28 Sept? 2026/);
    expect(html).not.toContain('Revised payslip');
  });

  it('September historical scenario: finalized payroll -> correction rejected -> reopen -> correct -> recalculate -> finalize -> revised payslip', async () => {
    const ctx = setup();
    SEPTEMBER_WORKING_DAYS.forEach((key) => { if (key !== ABSENT_DAY) ctx.addAttendance(key, 9); });
    // A payroll that was finalized before these safeguards existed, with a Bonus adjustment
    const draft = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);
    await ctx.payrollService.addOther(draft.id, 'Bonus', 'ALLOWANCE', 1000);
    Object.assign(ctx.payrollRow(draft.id), { status: 'FINALIZED' });
    const stale = { ...ctx.payrollRow(draft.id) };
    expect(stale).toEqual(expect.objectContaining({ grossSalary: 61000, netSalary: 54343, lopDays: 1 }));

    await expect(ctx.attendanceService.addMissedAttendance(missedPunchOut, hrActor)).rejects.toThrow(
      'Payroll for 9/2026 is finalized. Reopen the payroll before making this change.',
    );
    expect(ctx.prisma.tables.attendanceRecord.find((row: Row) => keyOf(row.date) === ABSENT_DAY)).toBeUndefined();

    await expect(ctx.payrollService.reopenPayroll(draft.id, '  ', hrActor)).rejects.toThrow('A reason is required');
    await expect(
      ctx.payrollService.reopenPayroll(draft.id, 'Correction', { ...hrActor, role: 'FINANCE_MANAGER' }),
    ).rejects.toThrow('Access denied');

    const reopened = await ctx.payrollService.reopenPayroll(draft.id, 'Sept 2026 missed punch-out correction', hrActor);
    expect(reopened).toEqual(expect.objectContaining({ status: 'DRAFT', revision: 1, needsRecalculation: true }));
    const reopenAudit = ctx.prisma.tables.auditLog.find((log: Row) => log.action === 'PAYROLL_REOPENED');
    expect(JSON.parse(reopenAudit.previousVal)).toEqual(expect.objectContaining({ status: 'FINALIZED', netSalary: 54343 }));
    expect(JSON.parse(reopenAudit.newVal)).toEqual(expect.objectContaining({ reason: 'Sept 2026 missed punch-out correction', revision: 1 }));
    expect(reopenAudit.userEmail).toBe('hr@example.com');

    await ctx.attendanceService.addMissedAttendance(missedPunchOut, hrActor);

    const preview = await ctx.payrollService.previewRecalculation(draft.id);
    const changed = preview.differences.map((diff: any) => diff.field);
    expect(changed).toEqual(['presentDays', 'lopDays', 'leaveDeduction', 'deductions', 'netSalary']);

    const recalculated = await ctx.payrollService.recalculatePayroll(draft.id, hrActor);
    expect(recalculated).toEqual(expect.objectContaining({
      otherAllowance: 1000, grossSalary: 61000, lopDays: 0, netSalary: 57200, revision: 1,
    }));
    expect(ctx.prisma.tables.payrollAdjustment).toEqual([
      expect.objectContaining({ payrollId: draft.id, name: 'Bonus', type: 'ALLOWANCE', amount: 1000 }),
    ]);

    await ctx.payrollService.finalizePayroll(draft.id, hrActor);
    const html = await ctx.renderPayslip(draft.id);
    expect(html).toContain('Revised payslip (revision 1)');
    expect(html).toContain('57,200.00');
    expect(html).toContain('Bonus');
    expect(html).not.toContain('54,343.00');
  });

  it('correcting September through reopen leaves October payroll untouched, without extra rows or recalculation on reopen', async () => {
    const ctx = setup();
    [...SEPTEMBER_WORKING_DAYS, ...OCTOBER_WORKING_DAYS]
      .forEach((key) => { if (key !== ABSENT_DAY) ctx.addAttendance(key, 9); });
    const september = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);
    await ctx.payrollService.addOther(september.id, 'Bonus', 'ALLOWANCE', 1000);
    Object.assign(ctx.payrollRow(september.id), { status: 'FINALIZED' });
    const october = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 10, year: 2026 } as any);
    const octoberBefore = { ...ctx.payrollRow(october.id) };
    const septemberBefore = { ...ctx.payrollRow(september.id) };

    const reopened = await ctx.payrollService.reopenPayroll(september.id, 'Sept correction', hrActor);
    // Reopen changes state only; no recalculation, no new payroll row, no adjustment change
    const financialFields = ['presentDays', 'lopDays', 'leaveDeduction', 'grossSalary', 'deductions', 'netSalary', 'otherAllowance'];
    for (const field of financialFields) expect(reopened[field]).toBe(septemberBefore[field]);
    expect(ctx.prisma.tables.payroll).toHaveLength(2);
    expect(ctx.prisma.tables.payrollAdjustment).toHaveLength(1);

    await ctx.attendanceService.addMissedAttendance(missedPunchOut, hrActor);
    // Same-day attendance uniqueness: exactly one record for the corrected day
    const sept15 = ctx.prisma.tables.attendanceRecord.filter((row: Row) => keyOf(row.date) === '2026-09-15');
    expect(sept15).toHaveLength(1);
    expect(sept15[0].clockOut).toEqual(new Date('2026-09-15T12:30:00.000Z'));

    await ctx.payrollService.recalculatePayroll(september.id, hrActor);
    await ctx.payrollService.finalizePayroll(september.id, hrActor);

    expect(ctx.payrollRow(october.id)).toEqual(octoberBefore);
    expect(ctx.payrollRow(october.id).needsRecalculation).toBe(false);
    expect(ctx.prisma.tables.payroll).toHaveLength(2);
    expect(ctx.prisma.tables.payrollAdjustment).toHaveLength(1);
    expect(ctx.payrollRow(september.id)).toEqual(expect.objectContaining({
      status: 'FINALIZED', revision: 1, needsRecalculation: false, netSalary: 57200,
    }));

    // The payslip prints exactly the persisted net
    const html = await ctx.renderPayslip(september.id);
    expect(html).toContain(`₹${ctx.payrollRow(september.id).netSalary.toLocaleString('en-IN')}.00`);
  });

  it('rejects attendance correction for a PAID payroll period', async () => {
    const ctx = setup();
    SEPTEMBER_WORKING_DAYS.forEach((key) => { if (key !== ABSENT_DAY) ctx.addAttendance(key, 9); });
    const payroll = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);
    ctx.payrollRow(payroll.id).status = 'PAID';

    await expect(ctx.attendanceService.addMissedAttendance(missedPunchOut, hrActor)).rejects.toThrow('Payroll for 9/2026 is finalized');
    await expect(ctx.payrollService.recalculatePayroll(payroll.id, hrActor)).rejects.toThrow('Only draft payroll can be recalculated');
    expect(ctx.prisma.tables.attendanceRecord.find((row: Row) => keyOf(row.date) === ABSENT_DAY)).toBeUndefined();
  });

  it('approved attendance regularization marks DRAFT payroll stale and is rejected for a finalized period', async () => {
    const ctx = setup();
    SEPTEMBER_WORKING_DAYS.forEach((key) => { if (key !== ABSENT_DAY) ctx.addAttendance(key, 9); });
    // Regularization needs an existing record: a check-in without check-out
    ctx.addAttendance(ABSENT_DAY, null);
    const payroll = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);
    const request = { requestedClockIn: '2026-09-15T03:30:00.000Z', requestedClockOut: '2026-09-15T12:30:00.000Z', reason: 'Missed punch-out' };

    const first = await ctx.attendanceService.requestRegularization(request, USER_ID, 'asha@example.com');
    await ctx.attendanceService.processRegularization(first.id, 'APPROVED' as any, 'hr@example.com');
    expect(ctx.payrollRow(payroll.id).needsRecalculation).toBe(true);

    ctx.payrollRow(payroll.id).status = 'FINALIZED';
    const second = await ctx.attendanceService.requestRegularization(request, USER_ID, 'asha@example.com');
    await expect(
      ctx.attendanceService.processRegularization(second.id, 'APPROVED' as any, 'hr@example.com'),
    ).rejects.toThrow('Payroll for 9/2026 is finalized');
  });

  it('reopen rejects DRAFT and PAID payroll', async () => {
    const ctx = setup();
    SEPTEMBER_WORKING_DAYS.forEach((key) => ctx.addAttendance(key, 9));
    const payroll = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);

    await expect(ctx.payrollService.reopenPayroll(payroll.id, 'Fix', hrActor)).rejects.toThrow('Only finalized payroll can be reopened');
    ctx.payrollRow(payroll.id).status = 'PAID';
    await expect(ctx.payrollService.reopenPayroll(payroll.id, 'Fix', hrActor)).rejects.toThrow('Paid payroll cannot be reopened');
    expect(ctx.auditActions()).toEqual([]);
  });

  it('finalize rejects a negative net salary', async () => {
    const ctx = setup();
    SEPTEMBER_WORKING_DAYS.forEach((key) => ctx.addAttendance(key, 9));
    const payroll = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);
    await ctx.payrollService.addOther(payroll.id, 'Recovery', 'DEDUCTION', 70000);

    await expect(ctx.payrollService.finalizePayroll(payroll.id, hrActor)).rejects.toThrow('negative net salary');
    expect(ctx.payrollRow(payroll.id).status).toBe('DRAFT');
  });

  it('holiday changes mark DRAFT payroll stale and are rejected for a finalized 29th-28th period', async () => {
    const ctx = setup();
    SEPTEMBER_WORKING_DAYS.forEach((key) => ctx.addAttendance(key, 9));
    const september = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);

    // 30 Sep belongs to the October payroll period, not September
    await ctx.holidaysService.createHoliday({ name: 'Local holiday', date: '2026-09-30' } as any);
    expect(ctx.payrollRow(september.id).needsRecalculation).toBe(false);

    await ctx.holidaysService.createHoliday({ name: 'Festival', date: '2026-09-10' } as any);
    expect(ctx.payrollRow(september.id).needsRecalculation).toBe(true);

    // Holiday changes never calculate payroll or create rows; they only flag it
    expect(ctx.payrollRow(september.id).netSalary).toBe(september.netSalary);
    expect(ctx.prisma.tables.payroll).toHaveLength(1);

    ctx.payrollRow(september.id).status = 'FINALIZED';
    await expect(
      ctx.holidaysService.createHoliday({ name: 'Another', date: '2026-08-31' } as any),
    ).rejects.toThrow('Holiday cannot be changed for a finalized or paid payroll period');
    await expect(
      ctx.holidaysService.createHoliday({ name: 'October', date: '2026-10-01' } as any),
    ).resolves.toEqual(expect.objectContaining({ name: 'October' }));
  });
});

describe('Check-in without check-out (integration)', () => {
  const CHECK_IN_ONLY_DAY = '2026-09-15';
  const fullMonthNet = 56200; // 21 present days, no LOP

  const setupWithCheckInOnlyDay = () => {
    const ctx = setup();
    SEPTEMBER_WORKING_DAYS.forEach((key) => ctx.addAttendance(key, key === CHECK_IN_ONLY_DAY ? null : 9));
    return ctx;
  };
  const runSeptember = (ctx: ReturnType<typeof setup>) =>
    ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);

  it('treats check-in + check-out and check-in without check-out as PRESENT', async () => {
    const ctx = setupWithCheckInOnlyDay();
    const { startDate, endDateExclusive } = { startDate: businessDate('2026-08-29'), endDateExclusive: businessDate('2026-09-29') };

    const history = await ctx.attendanceService.getAttendanceHistoryForDateRange(USER_ID, EMPLOYEE_ID, startDate, endDateExclusive);
    const statusByDay = Object.fromEntries(history.map((record: Row) => [keyOf(record.date), record.status]));
    expect(statusByDay[CHECK_IN_ONLY_DAY]).toBe('PRESENT');
    expect(statusByDay['2026-09-14']).toBe('PRESENT');
    expect(history.some((record: Row) => record.status === 'IN_PROGRESS')).toBe(false);
  });

  it('a check-in-only day creates no LOP and does not reduce net salary', async () => {
    const ctx = setupWithCheckInOnlyDay();

    await expect(runSeptember(ctx)).resolves.toEqual(expect.objectContaining({
      workingDays: 21, presentDays: 21, lopDays: 0, leaveDeduction: 0, deductions: 3800, netSalary: fullMonthNet,
    }));
  });

  it('a payroll with a check-in-only day can be finalized and its payslip matches the stored payroll', async () => {
    const ctx = setupWithCheckInOnlyDay();
    const payroll = await runSeptember(ctx);

    await ctx.payrollService.finalizePayroll(payroll.id, hrActor);
    expect(ctx.payrollRow(payroll.id).status).toBe('FINALIZED');

    const html = await ctx.renderPayslip(payroll.id);
    expect(html).toContain(`₹${ctx.payrollRow(payroll.id).netSalary.toLocaleString('en-IN')}.00`);
    expect(html).toContain('56,200.00');
  });

  it('HR can still record the missed check-out: same record updated, payroll flagged, pay unchanged', async () => {
    const ctx = setupWithCheckInOnlyDay();
    const payroll = await runSeptember(ctx);

    await ctx.attendanceService.addMissedAttendance(missedPunchOut, hrActor);
    const records = ctx.prisma.tables.attendanceRecord.filter((row: Row) => keyOf(row.date) === CHECK_IN_ONLY_DAY);
    expect(records).toHaveLength(1);
    expect(records[0].clockOut).toEqual(new Date('2026-09-15T12:30:00.000Z'));
    expect(ctx.payrollRow(payroll.id).needsRecalculation).toBe(true);

    await expect(ctx.payrollService.recalculatePayroll(payroll.id, hrActor)).resolves.toEqual(
      expect.objectContaining({ presentDays: 21, lopDays: 0, netSalary: fullMonthNet, needsRecalculation: false }),
    );
  });

  it('completed days keep the hours rule: a 3-hour checked-out day is still ABSENT', async () => {
    const ctx = setup();
    SEPTEMBER_WORKING_DAYS.forEach((key) => ctx.addAttendance(key, key === CHECK_IN_ONLY_DAY ? 3 : 9));

    await expect(runSeptember(ctx)).resolves.toEqual(expect.objectContaining({ presentDays: 20, lopDays: 1, netSalary: 53343 }));
  });

  it('half-day leave + check-in without check-out = 1 payable day', async () => {
    const ctx = setupWithCheckInOnlyDay();
    ctx.addLeave({ startDate: CHECK_IN_ONLY_DAY, endDate: CHECK_IN_ONLY_DAY, durationType: 'HALF_DAY_FIRST', totalDays: 0.5, paidLeaveDays: 0.5, lopDays: 0 });

    await expect(runSeptember(ctx)).resolves.toEqual(expect.objectContaining({ presentDays: 20.5, paidLeaveDays: 0.5, lopDays: 0 }));
  });

  it('a pending leave does not turn a check-in-only day into an absence', async () => {
    const ctx = setupWithCheckInOnlyDay();
    ctx.addLeave({ startDate: CHECK_IN_ONLY_DAY, endDate: CHECK_IN_ONLY_DAY, status: 'PENDING', totalDays: 1, paidLeaveDays: 0, lopDays: 0 });

    await expect(runSeptember(ctx)).resolves.toEqual(expect.objectContaining({ presentDays: 21, lopDays: 0 }));
  });

  it('full-day approved leave is unchanged on a check-in-only day', async () => {
    const ctx = setupWithCheckInOnlyDay();
    ctx.addLeave({ startDate: CHECK_IN_ONLY_DAY, endDate: CHECK_IN_ONLY_DAY, totalDays: 1, paidLeaveDays: 1, lopDays: 0 });

    await expect(runSeptember(ctx)).resolves.toEqual(expect.objectContaining({ presentDays: 20, paidLeaveDays: 1, lopDays: 0 }));
  });
});

describe('Gross-based salary structure (integration)', () => {
  const standardGrossStructure = { basicPercent: 35, hraPercent: 40, conveyancePercent: 0, conveyanceAmount: 2000, pfPercent: 12, ptAmount: 200 };

  it('calculates payroll from Monthly Gross (not CTC), uses Gross for LOP, and the payslip prints the stored values', async () => {
    const ctx = setup();
    // CTC is deliberately different from Gross
    Object.assign(ctx.prisma.tables.employeeSalary[0], { monthlyCTC: 55000, annualCTC: 660000, monthlyGross: 50000, structure: standardGrossStructure });
    SEPTEMBER_WORKING_DAYS.forEach((key) => { if (key !== ABSENT_DAY) ctx.addAttendance(key, 9); });

    const payroll = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);
    expect(payroll).toEqual(expect.objectContaining({
      grossSalary: 50000, basic: 17500, hra: 7000, conveyance: 2000, specialAllowance: 23500,
      pf: 2100, pt: 200, lopDays: 1, leaveDeduction: 2381, deductions: 4681, netSalary: 45319,
    }));

    await ctx.payrollService.finalizePayroll(payroll.id, hrActor);
    const html = await ctx.renderPayslip(payroll.id);
    for (const amount of ['17,500.00', '7,000.00', '2,000.00', '23,500.00', '50,000.00', '45,319.00']) {
      expect(html).toContain(amount);
    }
    expect(html).not.toContain('55,000.00');
  });

  it('a new effective-dated salary row applies from its payroll period; the earlier row and earlier period are unchanged', async () => {
    const ctx = setup();
    const historicalRow = { ...ctx.prisma.tables.employeeSalary[0] };
    ctx.prisma.tables.employeeSalary.push({
      id: 3, employeeId: EMPLOYEE_ID, monthlyCTC: 55000, annualCTC: 660000, monthlyGross: 50000,
      effectiveFrom: new Date('2026-09-29T00:00:00.000Z'), structure: standardGrossStructure,
    });
    [...SEPTEMBER_WORKING_DAYS, ...OCTOBER_WORKING_DAYS].forEach((key) => ctx.addAttendance(key, 9));

    const september = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);
    const october = await ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 10, year: 2026 } as any);

    // September still uses the historical legacy row (CTC basis)
    expect(september).toEqual(expect.objectContaining({ salaryId: 2, grossSalary: 60000, netSalary: 56200 }));
    // October uses the new Gross-based row
    expect(october).toEqual(expect.objectContaining({ salaryId: 3, grossSalary: 50000, basic: 17500, netSalary: 47700 }));
    expect(ctx.prisma.tables.employeeSalary[0]).toEqual(historicalRow);
  });
});

describe('Payroll leave period boundary (integration)', () => {
  const runPeriod = async (ctx: ReturnType<typeof setup>, month: number) =>
    ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month, year: 2026 } as any);

  // Leave Thu 24 Sep - Thu 1 Oct: 24, 25, 28 Sep fall in September; 29, 30 Sep, 1 Oct in October
  const crossingLeave = { startDate: '2026-09-24', endDate: '2026-10-01', totalDays: 6 };
  const leaveKeys = ['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];

  const seedAttendanceExcept = (ctx: ReturnType<typeof setup>, skip: string[]) =>
    [...SEPTEMBER_WORKING_DAYS, ...OCTOBER_WORKING_DAYS]
      .filter((key) => !skip.includes(key))
      .forEach((key) => ctx.addAttendance(key, 9));

  it('leave entirely inside the period is unchanged', async () => {
    const ctx = setup();
    seedAttendanceExcept(ctx, ['2026-09-08', '2026-09-09']);
    ctx.addLeave({ startDate: '2026-09-08', endDate: '2026-09-09', totalDays: 2, paidLeaveDays: 2, lopDays: 0 });

    await expect(runPeriod(ctx, 9)).resolves.toEqual(expect.objectContaining({
      presentDays: 19, paidLeaveDays: 2, lopDays: 0, leaveDeduction: 0,
    }));
  });

  it('paid leave crossing the 28/29 boundary only counts its days inside each period', async () => {
    const ctx = setup();
    seedAttendanceExcept(ctx, [...leaveKeys, '2026-09-01']);
    ctx.addLeave({ ...crossingLeave, paidLeaveDays: 6, lopDays: 0 });

    // Previously the whole 6 paid days were counted, hiding the 1 Sep absence
    await expect(runPeriod(ctx, 9)).resolves.toEqual(expect.objectContaining({ paidLeaveDays: 3, lopDays: 1 }));
    await expect(runPeriod(ctx, 10)).resolves.toEqual(expect.objectContaining({ paidLeaveDays: 3, lopDays: 0 }));
  });

  it('LOP leave crossing the boundary is not deducted twice', async () => {
    const ctx = setup();
    seedAttendanceExcept(ctx, leaveKeys);
    ctx.addLeave({ ...crossingLeave, paidLeaveDays: 0, lopDays: 6 });

    await expect(runPeriod(ctx, 9)).resolves.toEqual(expect.objectContaining({ paidLeaveDays: 0, lopDays: 3 }));
    await expect(runPeriod(ctx, 10)).resolves.toEqual(expect.objectContaining({ paidLeaveDays: 0, lopDays: 3 }));
  });

  it('mixed paid + LOP leave crossing the boundary keeps its approved totals across both periods', async () => {
    const ctx = setup();
    seedAttendanceExcept(ctx, leaveKeys);
    ctx.addLeave({ ...crossingLeave, paidLeaveDays: 4, lopDays: 2 });

    const september = await runPeriod(ctx, 9);
    const october = await runPeriod(ctx, 10);
    expect(september).toEqual(expect.objectContaining({ paidLeaveDays: 3, lopDays: 0 }));
    expect(october).toEqual(expect.objectContaining({ paidLeaveDays: 1, lopDays: 2 }));
    expect(Number(september.paidLeaveDays) + Number(october.paidLeaveDays)).toBe(4);
    expect(september.lopDays + october.lopDays).toBe(2);

    const preview = await ctx.payrollService.previewRecalculation(september.id);
    expect(preview.splitMixedLeaveIds).toHaveLength(1);
  });
});

describe('Payroll half-day leave (integration)', () => {
  const HALF_DAY = '2026-09-10';

  const runWith = async (hoursOnHalfDay: number | null, leave: Row) => {
    const ctx = setup();
    SEPTEMBER_WORKING_DAYS.forEach((key) => {
      if (key !== HALF_DAY) ctx.addAttendance(key, 9);
      else if (hoursOnHalfDay !== null) ctx.addAttendance(key, hoursOnHalfDay);
    });
    ctx.addLeave({ startDate: HALF_DAY, endDate: HALF_DAY, ...leave });
    return ctx.payrollService.runPayroll({ employeeId: EMPLOYEE_ID, month: 9, year: 2026 } as any);
  };
  const halfDayPaid = { durationType: 'HALF_DAY_FIRST', totalDays: 0.5, paidLeaveDays: 0.5, lopDays: 0 };

  it('half-day leave + half day worked = 1 payable day, 0 LOP', async () => {
    await expect(runWith(4.5, halfDayPaid)).resolves.toEqual(expect.objectContaining({
      presentDays: 20.5, paidLeaveDays: 0.5, lopDays: 0, leaveDeduction: 0,
    }));
  });

  it('half-day leave + full day worked is capped at 1 payable day', async () => {
    await expect(runWith(9, halfDayPaid)).resolves.toEqual(expect.objectContaining({
      presentDays: 20.5, paidLeaveDays: 0.5, lopDays: 0,
    }));
  });

  it('half-day leave + no attendance = 0.5 payable, 0.5 LOP', async () => {
    await expect(runWith(null, halfDayPaid)).resolves.toEqual(expect.objectContaining({
      presentDays: 20, paidLeaveDays: 0.5, lopDays: 0.5, leaveDeduction: 1429,
    }));
  });

  it('half-day LOP leave + half day worked leaves 0.5 LOP', async () => {
    await expect(
      runWith(4.5, { durationType: 'HALF_DAY_SECOND', totalDays: 0.5, paidLeaveDays: 0, lopDays: 0.5 }),
    ).resolves.toEqual(expect.objectContaining({ presentDays: 20.5, paidLeaveDays: 0, lopDays: 0.5 }));
  });

  it('full-day leave behavior is unchanged', async () => {
    await expect(
      runWith(9, { durationType: 'FULL_DAY', totalDays: 1, paidLeaveDays: 1, lopDays: 0 }),
    ).resolves.toEqual(expect.objectContaining({ presentDays: 20, paidLeaveDays: 1, lopDays: 0 }));
  });
});
