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
import { getBusinessDateKey } from '../attendance/utils/business-date.util';
import {
  EMPLOYEE_VISIBLE_PAYROLL_STATUSES,
  getPayrollPeriodDates,
  getPayrollPeriodRange,
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

    const data = await this.calculatePayrollData(
      existingPayroll.employeeId,
      existingPayroll.month,
      existingPayroll.year,
      existingPayroll,
    );

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
      const key = getBusinessDateKey(record.date);
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

    const adjustmentAllowance = (existingPayroll?.others ?? [])
      .filter((adjustment: any) => adjustment.type === 'ALLOWANCE')
      .reduce((sum: number, adjustment: any) => sum + Number(adjustment.amount ?? 0), 0);
    const adjustmentDeduction = (existingPayroll?.others ?? [])
      .filter((adjustment: any) => adjustment.type === 'DEDUCTION')
      .reduce((sum: number, adjustment: any) => sum + Number(adjustment.amount ?? 0), 0);
    const otherAllowance = Number(existingPayroll?.otherAllowance ?? adjustmentAllowance);
    const otherDeduction = Number(existingPayroll?.otherDeduction ?? adjustmentDeduction);
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
    };
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
