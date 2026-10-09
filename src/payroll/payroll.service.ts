import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
  forwardRef,
} from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { RunPayrollDto } from './dto/run-payroll.dto';
import { PayrollCalculator } from './payroll.calculator';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { HolidaysService } from '../holidays/holidays.service';
import { AttendanceService } from '../attendance/attendance.service';
import {
  AuthorizationService,
  AuthorizationUser,
} from '../common/authorization/authorization.service';
import { getAttendanceRecordBusinessDateKey, getBusinessDateKey } from '../attendance/utils/business-date.util';
import {
  EMPLOYEE_VISIBLE_PAYROLL_STATUSES,
  getPayrollPeriodDates,
  getPayrollPeriodRange,
  LEGACY_ROUNDING_TOLERANCE,
} from './payroll-period.util';

const PAYROLL_CORRECTION_ROLES = ['SUPER_ADMIN', 'CEO', 'HR'];

/* Persisted payroll fields compared by the recalculation preview */
const PAYROLL_FINANCIAL_FIELDS = [
  'salaryId',
  'workingDays',
  'presentDays',
  'lopDays',
  'paidLeaveDays',
  'basic',
  'hra',
  'conveyance',
  'specialAllowance',
  'otherAllowance',
  'pf',
  'pt',
  'leaveDeduction',
  'otherDeduction',
  'grossSalary',
  'deductions',
  'netSalary',
] as const;

type HistoricalAdjustmentIssue = {
  code: string;
  blocking: boolean;
  message: string;
  amount: number;
};

const attendanceContribution = (status: AttendanceStatus | string | undefined) => {
  if (status === AttendanceStatus.PRESENT || status === AttendanceStatus.LATE) return 1;
  if (status === AttendanceStatus.HALF_DAY) return 0.5;
  return 0;
};

@Injectable()
export class PayrollService {
  private readonly attendanceService: AttendanceService;

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => EmployeesService))
    private employeesService: EmployeesService,
    private authorizationService: AuthorizationService,
    private workingDaysService: WorkingDaysService,
  ) {
    this.attendanceService = new AttendanceService(
      this.prisma,
      new HolidaysService(this.prisma),
      undefined,
      this.workingDaysService,
    );
  }

  private async getPeriodWorkingDates(employeeId: number, startDate: Date, endDate: Date) {
    const dates: Date[] = [];
    for (let date = new Date(startDate); date <= endDate; date.setUTCDate(date.getUTCDate() + 1)) {
      dates.push(new Date(date));
    }

    return this.workingDaysService.getWorkingDates(employeeId, dates);
  }

  private async calculateWorkingDays(employeeId: number, startDate: Date, endDate: Date) {
    return (await this.getPeriodWorkingDates(employeeId, startDate, endDate)).length;
  }

  private auditActor(actor?: AuthorizationUser) {
    return { userId: actor?.id ?? null, userEmail: actor?.email ?? 'system' };
  }

  private ensurePayrollCorrectionRole(actor?: AuthorizationUser) {
    if (!PAYROLL_CORRECTION_ROLES.includes(String(actor?.role ?? '').toUpperCase())) {
      throw new ForbiddenException('Access denied');
    }
  }

  private normalizePositiveInteger(value: unknown, fieldName: string): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue <= 0) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }

    return numericValue;
  }

  private normalizeMonth(value: unknown): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue < 1 || numericValue > 12) {
      throw new BadRequestException('Invalid month');
    }

    return numericValue;
  }

  private normalizeYear(value: unknown): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue < 1) {
      throw new BadRequestException('Invalid year');
    }

    return numericValue;
  }

  /* Resolve employeeId/empCode + month/year from the request */

  private async resolveEmployeeAndPeriod(data: RunPayrollDto) {
    let employeeId: number | undefined;

    if (data.employeeId !== undefined && data.employeeId !== null) {
      employeeId = this.normalizePositiveInteger(data.employeeId, 'employeeId');
    }

    const month = this.normalizeMonth(data.month);
    const year = this.normalizeYear(data.year);

    if (!employeeId && data.empCode) {
      const employee = await this.employeesService.findByEmpCode(data.empCode);
      employeeId = this.normalizePositiveInteger(employee.id, 'employeeId');
    }

    if (!employeeId) {
      throw new BadRequestException('Invalid payroll request');
    }

    return { employeeId, month, year };
  }

  /* 🔥 MAIN PAYROLL */

  async runPayroll(data: RunPayrollDto) {
    const { employeeId, month, year } = await this.resolveEmployeeAndPeriod(data);

    const existing = await this.prisma.payroll.findFirst({
      where: { employeeId, month, year },
    });

    if (existing) {
      throw new BadRequestException('Payroll already exists');
    }

    return this.computePayroll(employeeId, month, year);
  }

  /* Manual "Generate Payslip" action - reuses the payroll for the period
     if it was already run, otherwise computes it on the fly. */

  async generateOrGetPayroll(data: RunPayrollDto) {
    const { employeeId, month, year } = await this.resolveEmployeeAndPeriod(data);

    const existing = await this.prisma.payroll.findFirst({
      where: { employeeId, month, year },
    });

    if (existing) {
      return existing;
    }

    return this.computePayroll(employeeId, month, year);
  }

  private async computePayroll(employeeId: number, month: number, year: number) {
    const data = await this.calculatePayrollData(employeeId, month, year);
    return this.prisma.payroll.create({ data });
  }

  async recalculatePayroll(payrollId: number, actor?: AuthorizationUser) {
    const normalizedPayrollId = this.normalizePositiveInteger(payrollId, 'payrollId');
    const existingPayroll = await this.prisma.payroll.findUnique({
      where: { id: normalizedPayrollId },
      include: { others: true },
    });

    if (!existingPayroll) {
      throw new BadRequestException('Payroll not found');
    }

    if (existingPayroll.status !== 'DRAFT') {
      throw new BadRequestException('Only draft payroll can be recalculated');
    }

    const calculation = await this.buildPayrollCalculation(
      existingPayroll.employeeId,
      existingPayroll.month,
      existingPayroll.year,
      existingPayroll,
    );
    this.assertNoBlockingAdjustmentIssues(calculation.historicalAdjustments.issues);
    const { data } = calculation;

    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const updatedPayroll = await tx.payroll.update({
          where: { id: normalizedPayrollId, status: 'DRAFT' },
          data: { ...data, needsRecalculation: false },
        });

        await tx.auditLog.create({
          data: {
            ...this.auditActor(actor),
            action: 'PAYROLL_RECALCULATED',
            module: 'PAYROLL',
            previousVal: JSON.stringify(this.pickFinancialFields(existingPayroll)),
            newVal: JSON.stringify(this.pickFinancialFields(updatedPayroll)),
          },
        });

        return updatedPayroll;
      });
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new BadRequestException('Only draft payroll can be recalculated');
      }
      throw error;
    }
  }

  private pickFinancialFields(payroll: any) {
    return Object.fromEntries(
      PAYROLL_FINANCIAL_FIELDS.map((field) => [field, payroll?.[field] ?? null]),
    ) as Record<(typeof PAYROLL_FINANCIAL_FIELDS)[number], number | null>;
  }

  /* Read-only: runs the same calculation as recalculation and reports
     what would change. Writes nothing. */
  async previewRecalculation(payrollId: number) {
    const normalizedPayrollId = this.normalizePositiveInteger(payrollId, 'payrollId');
    const existingPayroll = await this.prisma.payroll.findUnique({
      where: { id: normalizedPayrollId },
      include: { others: true },
    });

    if (!existingPayroll) {
      throw new BadRequestException('Payroll not found');
    }

    const calculation = await this.buildPayrollCalculation(
      existingPayroll.employeeId,
      existingPayroll.month,
      existingPayroll.year,
      existingPayroll,
    );
    const stored = this.pickFinancialFields(existingPayroll);
    const recalculated = this.pickFinancialFields(calculation.data);
    const differences = PAYROLL_FINANCIAL_FIELDS
      .filter((field) => {
        const before = stored[field];
        const after = recalculated[field];
        if (before === null || after === null) return before !== after;
        return Math.abs(Number(before) - Number(after)) > 0.005;
      })
      .map((field) => ({
        field,
        stored: stored[field],
        recalculated: recalculated[field],
        delta:
          stored[field] === null || recalculated[field] === null
            ? null
            : Number(recalculated[field]) - Number(stored[field]),
      }));
    return {
      payrollId: existingPayroll.id,
      employeeId: existingPayroll.employeeId,
      month: existingPayroll.month,
      year: existingPayroll.year,
      status: existingPayroll.status,
      needsRecalculation: existingPayroll.needsRecalculation ?? false,
      revision: existingPayroll.revision ?? 0,
      period: getPayrollPeriodDates(existingPayroll.month, existingPayroll.year),
      stored,
      recalculated,
      differences,
      splitMixedLeaveIds: calculation.splitMixedLeaveIds,
      // Amounts carried from earlier adjustments, and anything blocking recalculation
      historicalAdjustments: {
        legacyRecord: calculation.historicalAdjustments.legacyRecord,
        recordedAllowance: calculation.historicalAdjustments.recordedAllowance,
        recordedDeduction: calculation.historicalAdjustments.recordedDeduction,
        carriedOtherAllowance: calculation.historicalAdjustments.otherAllowance,
        carriedOtherDeduction: calculation.historicalAdjustments.otherDeduction,
        issues: calculation.historicalAdjustments.issues,
        blocksRecalculation: calculation.historicalAdjustments.issues.some((issue) => issue.blocking),
      },
      canRecalculate: existingPayroll.status === 'DRAFT',
    };
  }

  /* Correction workflow: FINALIZED -> DRAFT so it can be recalculated */
  async reopenPayroll(payrollId: number, reason: string, actor?: AuthorizationUser) {
    this.ensurePayrollCorrectionRole(actor);
    const normalizedPayrollId = this.normalizePositiveInteger(payrollId, 'payrollId');
    const normalizedReason = String(reason ?? '').trim();
    if (!normalizedReason) {
      throw new BadRequestException('A reason is required to reopen payroll');
    }

    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const payroll = await tx.payroll.findUnique({
          where: { id: normalizedPayrollId },
          include: { others: true },
        });

        if (!payroll) {
          throw new BadRequestException('Payroll not found');
        }
        if (payroll.status === 'PAID') {
          throw new BadRequestException('Paid payroll cannot be reopened');
        }
        if (payroll.status !== 'FINALIZED') {
          throw new BadRequestException('Only finalized payroll can be reopened');
        }

        const reopenedPayroll = await tx.payroll.update({
          where: { id: normalizedPayrollId, status: 'FINALIZED' },
          data: { status: 'DRAFT', revision: { increment: 1 }, needsRecalculation: true },
        });

        await tx.auditLog.create({
          data: {
            ...this.auditActor(actor),
            action: 'PAYROLL_REOPENED',
            module: 'PAYROLL',
            previousVal: JSON.stringify(payroll),
            newVal: JSON.stringify({
              payrollId: normalizedPayrollId,
              status: reopenedPayroll.status,
              revision: reopenedPayroll.revision,
              reason: normalizedReason,
            }),
          },
        });

        return reopenedPayroll;
      });
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new BadRequestException('Only finalized payroll can be reopened');
      }
      throw error;
    }
  }

  private async calculatePayrollData(
    employeeId: number,
    month: number,
    year: number,
    existingPayroll?: any,
  ) {
    return (await this.buildPayrollCalculation(employeeId, month, year, existingPayroll)).data;
  }

  /* The single payroll calculation path, used by run, recalculate and preview */
  private async buildPayrollCalculation(
    employeeId: number,
    month: number,
    year: number,
    existingPayroll?: any,
  ) {
    const { startDate, endDateExclusive, endDate } = getPayrollPeriodRange(month, year);

    /* Salary - use whichever salary was effective as of this payroll month */

    const salary = await this.prisma.employeeSalary.findFirst({
      where: { employeeId, effectiveFrom: { lte: endDate } },
      orderBy: { effectiveFrom: 'desc' },
      include: { structure: true },
    });

    if (!salary) {
      throw new BadRequestException('Salary not configured');
    }

    /* 🔥 Working Days */

    const workingDates = await this.getPeriodWorkingDates(employeeId, startDate, endDate);
    const workingDays = workingDates.length;
    const workingDateKeys = new Set(workingDates.map((date) => getBusinessDateKey(date)));

    /* 🔥 Canonical attendance history */

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    const attendanceHistory = await this.attendanceService.getAttendanceHistoryForDateRange(
      employee.userId,
      employeeId,
      startDate,
      endDateExclusive,
    );
    const leaveAllocation = await this.attendanceService.getLeaveDayAllocation(
      employeeId,
      startDate,
      endDateExclusive,
    );

    /* 🔥 Day-level payable/LOP count. Each working day is worth at most
       one payable day; approved leave only counts for the days inside
       this period, and a half-day leave keeps the half day worked. */

    const contributionByDate = new Map<string, number>();
    let nonWorkingDayPresence = 0;

    for (const record of attendanceHistory as any[]) {
      const key = getAttendanceRecordBusinessDateKey(record);
      if (workingDateKeys.has(key)) {
        contributionByDate.set(key, attendanceContribution(record.status));
      } else {
        // Existing behavior: presence on a non-working day still counts
        nonWorkingDayPresence += attendanceContribution(record.status);
      }
    }

    let presentDays = 0;
    let paidLeaveDays = 0;
    let leaveLopDays = 0;
    let absenceLopDays = 0;

    for (const key of workingDateKeys) {
      const leave = leaveAllocation.byDate.get(key) ?? { paid: 0, lop: 0 };
      const paid = Math.min(leave.paid, 1);
      const leaveLop = Math.min(leave.lop, 1 - paid);
      const dayPresent = Math.min(contributionByDate.get(key) ?? 0, 1 - paid - leaveLop);
      const dayPayable = Math.min(1, dayPresent + paid);

      presentDays += dayPresent;
      paidLeaveDays += paid;
      leaveLopDays += leaveLop;
      absenceLopDays += Math.max(1 - dayPayable - leaveLop, 0);
    }

    /* 🔥 FINAL LOGIC */

    presentDays += nonWorkingDayPresence;
    const attendanceLopDays = Math.max(absenceLopDays - nonWorkingDayPresence, 0);
    const lopDays = leaveLopDays + attendanceLopDays;

    /* 🔥 Calculation */

    const calc = PayrollCalculator.calculate(
      salary.monthlyGross ?? salary.monthlyCTC,
      salary.structure,
      workingDays,
      lopDays,
    );

    const historicalAdjustments = await this.resolveCarriedAdjustments(existingPayroll, salary);
    const { otherAllowance, otherDeduction } = historicalAdjustments;
    const grossSalary = calc.gross + otherAllowance;
    const deductions = calc.deductions + otherDeduction;

    const data = {
      employeeId,
      salaryId: salary.id,

      month,
      year,

      workingDays,
      presentDays,
      lopDays,
      paidLeaveDays,

      basic: calc.basic,
      hra: calc.hra,
      conveyance: calc.conveyance,
      specialAllowance: calc.specialAllowance,
      otherAllowance,
      pf: calc.pf,
      pt: calc.pt,
      leaveDeduction: calc.leaveDeduction,
      otherDeduction,

      grossSalary,
      deductions,
      netSalary: grossSalary - deductions,
    };

    return {
      data,
      splitMixedLeaveIds: leaveAllocation.splitMixedLeaveIds,
      historicalAdjustments,
    };
  }

  /* Allowance and deduction totals a recalculation carries forward.
     Payrolls created before the component columns were populated
     (conveyance / otherDeduction NULL) may hold adjustments only in their
     stored totals or in PayrollAdjustment rows the columns never reflected.
     Amounts the stored figures prove are carried; anything they cannot
     explain blocks recalculation instead of being guessed or dropped. */
  private async resolveCarriedAdjustments(existingPayroll: any, currentSalary: any) {
    const issues: HistoricalAdjustmentIssue[] = [];
    if (!existingPayroll) {
      return { legacyRecord: false, otherAllowance: 0, otherDeduction: 0, recordedAllowance: 0, recordedDeduction: 0, issues };
    }

    const recorded = (type: 'ALLOWANCE' | 'DEDUCTION') => (existingPayroll.others ?? [])
      .filter((adjustment: any) => adjustment.type === type)
      .reduce((sum: number, adjustment: any) => sum + Number(adjustment.amount ?? 0), 0);
    const recordedAllowance = recorded('ALLOWANCE');
    const recordedDeduction = recorded('DEDUCTION');
    const matches = (left: number, right: number) => Math.abs(left - right) <= LEGACY_ROUNDING_TOLERANCE;

    /* Deductions: a stored otherDeduction is authoritative (current behaviour).
       Without one, the stored total minus its components is what was deducted,
       the same rule addOther() and the payslip already apply. */
    let otherDeduction: number;
    if (existingPayroll.otherDeduction !== null && existingPayroll.otherDeduction !== undefined) {
      otherDeduction = Number(existingPayroll.otherDeduction);
    } else {
      const storedResidual = Number(existingPayroll.deductions ?? 0)
        - Number(existingPayroll.pf ?? 0)
        - Number(existingPayroll.pt ?? 0)
        - Number(existingPayroll.leaveDeduction ?? 0);

      if (recordedDeduction > 0) {
        // Recorded rows are only trusted when the stored total actually deducted them
        otherDeduction = recordedDeduction;
        if (!matches(storedResidual, recordedDeduction)) {
          issues.push({
            code: 'DEDUCTION_RECORDS_MISMATCH',
            blocking: true,
            message: `Recorded deduction adjustments (${recordedDeduction}) do not match the deductions stored on this payroll (${storedResidual}). Reconcile them manually before recalculating.`,
            amount: storedResidual - recordedDeduction,
          });
        }
      } else if (matches(storedResidual, 0)) {
        // Rounding difference of the old calculation, not an adjustment
        otherDeduction = 0;
      } else if (storedResidual > 0) {
        otherDeduction = storedResidual;
        issues.push({
          code: 'LEGACY_DEDUCTION_CARRIED',
          blocking: false,
          message: `A deduction of ${storedResidual} stored only in this payroll's totals is carried forward as other deductions. It may include up to ${LEGACY_ROUNDING_TOLERANCE} of old rounding.`,
          amount: storedResidual,
        });
      } else {
        otherDeduction = 0;
        issues.push({
          code: 'DEDUCTIONS_BELOW_COMPONENTS',
          blocking: true,
          message: `Stored deductions are ${-storedResidual} lower than PF, PT and leave deduction combined. Reconcile this payroll manually before recalculating.`,
          amount: storedResidual,
        });
      }
    }

    /* Allowances: current payrolls keep the stored otherAllowance. Legacy
       payrolls (conveyance NULL) are checked against the salary they were
       calculated on: every rupee of stored gross above it must be explained
       by recorded allowance rows. */
    let otherAllowance = Number(existingPayroll.otherAllowance ?? recordedAllowance);
    const legacyRecord = existingPayroll.conveyance === null;

    if (legacyRecord) {
      const legacySalary = existingPayroll.salaryId === currentSalary?.id
        ? currentSalary
        : await this.prisma.employeeSalary.findUnique({ where: { id: existingPayroll.salaryId } });

      if (!legacySalary) {
        issues.push({
          code: 'LEGACY_SALARY_MISSING',
          blocking: true,
          message: 'The salary this payroll was calculated on no longer exists, so its stored allowances cannot be verified. Reconcile this payroll manually before recalculating.',
          amount: 0,
        });
      } else {
        // Payrolls of this era were calculated on monthlyCTC
        const grossAboveSalary = Number(existingPayroll.grossSalary ?? 0) - Math.round(Number(legacySalary.monthlyCTC ?? 0));

        if (matches(grossAboveSalary, recordedAllowance)) {
          if (recordedAllowance - otherAllowance > LEGACY_ROUNDING_TOLERANCE) {
            issues.push({
              code: 'LEGACY_ALLOWANCE_RECORDS_CARRIED',
              blocking: false,
              message: `Allowance adjustments of ${recordedAllowance - otherAllowance} recorded on this payroll but missing from its other allowance are carried forward.`,
              amount: recordedAllowance - otherAllowance,
            });
          }
          otherAllowance = recordedAllowance;
        } else {
          const unexplained = grossAboveSalary - recordedAllowance;
          issues.push({
            code: 'UNEXPLAINED_LEGACY_GROSS',
            blocking: true,
            message: unexplained > 0
              ? `This payroll's stored gross includes ${unexplained} that no allowance record explains, most likely an allowance added before allowance records were kept. Recalculation stays blocked until the amount is confirmed and recorded as a historical adjustment through the authorized payroll data-reconciliation process. Do not re-enter it with + Adjust, which would count it twice.`
              : `Recorded allowance adjustments exceed this payroll's stored gross by ${-unexplained}, so they were never applied. Recalculation stays blocked until they are reconciled through the authorized payroll data-reconciliation process.`,
            amount: unexplained,
          });
        }
      }
    } else if (recordedAllowance - otherAllowance > LEGACY_ROUNDING_TOLERANCE) {
      // Already lost by an earlier recalculation; the current amount is kept as before
      issues.push({
        code: 'ALLOWANCE_RECORDS_NOT_REFLECTED',
        blocking: false,
        message: `Allowance adjustments of ${recordedAllowance - otherAllowance} are recorded but not included in this payroll. They were not paid by the previous calculation and need manual reconciliation.`,
        amount: recordedAllowance - otherAllowance,
      });
    }

    return { legacyRecord, otherAllowance, otherDeduction, recordedAllowance, recordedDeduction, issues };
  }

  private assertNoBlockingAdjustmentIssues(issues: HistoricalAdjustmentIssue[]) {
    const blocking = issues.filter((issue) => issue.blocking);
    if (blocking.length) {
      throw new BadRequestException(
        `Payroll cannot be recalculated safely: ${blocking.map((issue) => issue.message).join(' ')}`,
      );
    }
  }

  /* HR UPDATE */

  async updatePayroll(payrollId: number, data: any) {
    const payroll = await this.prisma.payroll.findUnique({ where: { id: payrollId } });
    if (payroll?.status === 'FINALIZED' || payroll?.status === 'PAID') {
      throw new BadRequestException('Payroll is finalized and cannot be modified');
    }

    return this.prisma.payroll.update({
      where: { id: payrollId },
      data,
    });
  }

  /* GET SINGLE PAYROLL BY ID (for ownership checks) */

  async getPayrollById(payrollId: number) {
    return this.prisma.payroll.findUnique({ where: { id: payrollId } });
  }

  /* GET PAYROLL FOR EMPLOYEE */

  async getPayroll(employeeId?: number, options: { finalizedOnly?: boolean } = {}) {
    if (employeeId !== undefined && (!Number.isInteger(employeeId) || employeeId <= 0)) {
      throw new BadRequestException('Invalid employee ID');
    }

    const where = {
      ...(employeeId === undefined ? {} : { employeeId }),
      ...(options.finalizedOnly ? { status: { in: EMPLOYEE_VISIBLE_PAYROLL_STATUSES } } : {}),
    };
    const payrolls = await this.prisma.payroll.findMany({
      ...(Object.keys(where).length ? { where } : {}),
      include: {
        salary: true,
        employee: {
          select: { id: true, empCode: true, firstName: true, lastName: true },
        },
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
      ],
    });

    // Period dates from the authoritative 29th-28th rule, for display
    return payrolls.map((payroll) => ({
      ...payroll,
      period: getPayrollPeriodDates(payroll.month, payroll.year),
    }));
  }

  async getEmployeesWithoutSalary() {
    return this.prisma.employee.findMany({
      where: {
        status: 'ACTIVE',
        salaries: { none: {} },
      },
      select: {
        id: true,
        empCode: true,
        firstName: true,
        lastName: true,
        department: true,
        designation: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async getEmployee360PayrollSummary(
    user: AuthorizationUser,
    employeeId: number,
  ) {
    const hasAccess = await this.authorizationService.canAccessEmployee(
      user,
      employeeId,
    );
    if (!hasAccess) {
      throw new ForbiddenException('Access denied');
    }

    // Employees never see DRAFT payroll figures, including their own
    const isEmployee = String(user?.role ?? '').toUpperCase() === 'EMPLOYEE';
    const payrollRecords = await this.prisma.payroll.findMany({
      where: {
        employeeId,
        ...(isEmployee ? { status: { in: EMPLOYEE_VISIBLE_PAYROLL_STATUSES } } : {}),
      },
      select: {
        month: true,
        year: true,
        status: true,
        grossSalary: true,
        deductions: true,
        netSalary: true,
        salary: { select: { effectiveFrom: true } },
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
      ],
    });

    return payrollRecords.map((payroll) => ({
      month: payroll.month,
      year: payroll.year,
      status: payroll.status,
      grossSalary: payroll.grossSalary,
      deductions: payroll.deductions,
      netSalary: payroll.netSalary,
      latestSalaryEffectiveDate: payroll.salary.effectiveFrom,
    }));
  }

  /* ADD ALLOWANCE OR DEDUCTION */

  async addOther(
    payrollId: number,
    name: string,
    type: 'ALLOWANCE' | 'DEDUCTION',
    amount: number,
  ) {
    const normalizedPayrollId = this.normalizePositiveInteger(payrollId, 'payrollId');

    const normalizedName = String(name ?? '').trim();
    if (!normalizedName) {
      throw new BadRequestException('Adjustment name is required');
    }

    const normalizedType = String(type ?? '').toUpperCase();
    if (normalizedType !== 'ALLOWANCE' && normalizedType !== 'DEDUCTION') {
      throw new BadRequestException('Adjustment type must be ALLOWANCE or DEDUCTION');
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new BadRequestException('Adjustment amount must be a positive number');
    }

    const payroll = await this.prisma.payroll.findUnique({
      where: { id: normalizedPayrollId },
    });

    if (!payroll) {
      throw new BadRequestException('Payroll not found');
    }

    if (payroll.status === 'FINALIZED' || payroll.status === 'PAID') {
      throw new BadRequestException('Payroll is finalized and cannot be modified');
    }

    const isAllowance = normalizedType === 'ALLOWANCE';
    const newGross = payroll.grossSalary + (isAllowance ? numericAmount : 0);
    const newDeductions = payroll.deductions + (isAllowance ? 0 : numericAmount);
    const existingOtherDeduction = payroll.otherDeduction ?? Math.max(
      payroll.deductions - payroll.pf - payroll.pt - payroll.leaveDeduction,
      0,
    );

    return this.prisma.$transaction(async (transaction: any) => {
      await transaction.payrollAdjustment.create({
        data: {
          payrollId: normalizedPayrollId,
          name: normalizedName,
          type: normalizedType as 'ALLOWANCE' | 'DEDUCTION',
          amount: numericAmount,
        },
      });

      return transaction.payroll.update({
        where: { id: normalizedPayrollId },
        data: {
          otherAllowance: { increment: isAllowance ? numericAmount : 0 },
          otherDeduction: existingOtherDeduction + (isAllowance ? 0 : numericAmount),
          grossSalary: newGross,
          deductions: newDeductions,
          netSalary: newGross - newDeductions,
        },
      });
    });
  }

  async finalizePayroll(payrollId: number, actor?: AuthorizationUser) {
    const normalizedPayrollId = this.normalizePositiveInteger(payrollId, 'payrollId');
    const payroll = await this.prisma.payroll.findUnique({
      where: { id: normalizedPayrollId },
    });

    if (!payroll) {
      throw new BadRequestException('Payroll not found');
    }

    if (payroll.status === 'PAID') {
      throw new BadRequestException('Paid payroll cannot be finalized');
    }

    if (payroll.status === 'FINALIZED') {
      return payroll;
    }

    // Attendance keeps arriving until the period ends; finalizing earlier would freeze incomplete figures
    const { endDate: periodEndDate } = getPayrollPeriodDates(payroll.month, payroll.year);
    if (getBusinessDateKey(new Date()) <= periodEndDate) {
      throw new BadRequestException(
        `Payroll for ${payroll.month}/${payroll.year} cannot be finalized before its payroll period ends on ${periodEndDate}. Recalculate and finalize it after the period ends.`,
      );
    }

    if (payroll.needsRecalculation) {
      throw new BadRequestException(
        'Attendance or leave changed after this payroll was calculated. Recalculate it before finalizing.',
      );
    }

    if (Number(payroll.netSalary) < 0) {
      throw new BadRequestException('Payroll with a negative net salary cannot be finalized');
    }

    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const finalizedPayroll = await tx.payroll.update({
          where: { id: normalizedPayrollId, status: 'DRAFT', needsRecalculation: false },
          data: { status: 'FINALIZED' },
        });

        await tx.auditLog.create({
          data: {
            ...this.auditActor(actor),
            action: 'PAYROLL_FINALIZED',
            module: 'PAYROLL',
            previousVal: null,
            newVal: JSON.stringify({
              payrollId: normalizedPayrollId,
              revision: finalizedPayroll.revision ?? 0,
              ...this.pickFinancialFields(finalizedPayroll),
            }),
          },
        });

        return finalizedPayroll;
      });
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new BadRequestException('Payroll changed while finalizing. Reload and try again.');
      }
      throw error;
    }
  }
}
