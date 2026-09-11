import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { RunPayrollDto } from './dto/run-payroll.dto';
import { PayrollCalculator } from './payroll.calculator';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import {
  AuthorizationService,
  AuthorizationUser,
} from '../common/authorization/authorization.service';

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => EmployeesService))
    private employeesService: EmployeesService,
    private authorizationService: AuthorizationService,
    private workingDaysService: WorkingDaysService,
  ) {}

  private async calculateWorkingDays(employeeId: number, startDate: Date, endDate: Date) {
    const dates: Date[] = [];
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      dates.push(new Date(date));
    }

    const workingDates = await this.workingDaysService.getWorkingDates(employeeId, dates);
    return workingDates.length;
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

  private classifyCompletedAttendanceContribution(hours: number): number {
    if (hours < 4) return 0;
    if (hours < 7) return 0.5;
    return 1;
  }

  private getAttendanceContribution(record: any): number {
    if (!record) return 0;

    const hasClockIn = record.clockIn != null;
    const hasClockOut = record.clockOut != null;

    if (!hasClockIn || !hasClockOut) {
      return 0;
    }

    const totalHours = Number(
      record.totalHours ??
        ((record.clockOut.getTime() - record.clockIn.getTime()) / 3600000),
    );

    return this.classifyCompletedAttendanceContribution(Number.isFinite(totalHours) ? totalHours : 0);
  }

  private isApprovedLeave(leave: any): boolean {
    return leave?.status === 'APPROVED';
  }

  private async computePayroll(employeeId: number, month: number, year: number) {
    /* Date Range */

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

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

    const workingDays = await this.calculateWorkingDays(employeeId, startDate, endDate);

    /* 🔥 Attendance */

    const attendanceRecords = await this.prisma.attendanceRecord.findMany({
      where: {
        user: { employee: { id: employeeId } },
        date: { gte: startDate, lte: endDate },
      },
    });

    let presentDays = 0;

    for (const att of attendanceRecords) {
      presentDays += this.getAttendanceContribution(att);
    }

    /* 🔥 Approved Leaves */

    const leaves = await this.prisma.leave.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });

    let approvedLeaveDays = 0;

    for (const leave of leaves) {
      if (!this.isApprovedLeave(leave)) continue;

      // Prorate leaves spanning a month boundary so only the days
      // that fall inside this payroll month are credited.
      const overlapStart = leave.startDate < startDate ? startDate : leave.startDate;
      const overlapEnd = leave.endDate > endDate ? endDate : leave.endDate;
      const overlapDays =
        Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
      const leaveSpanDays =
        Math.floor((leave.endDate.getTime() - leave.startDate.getTime()) / 86400000) + 1;

      approvedLeaveDays += leave.totalDays * (overlapDays / leaveSpanDays);
    }

    /* 🔥 FINAL LOGIC */

    const payableDays = presentDays + approvedLeaveDays;

    const lopDays = Math.max(workingDays - payableDays, 0);

    /* 🔥 Calculation */

    const calc = PayrollCalculator.calculate(
      salary.monthlyCTC,
      salary.structure,
      workingDays,
      lopDays,
    );

    /* SAVE */

    return this.prisma.payroll.create({
      data: {
        employeeId,
        salaryId: salary.id,

        month,
        year,

        workingDays,
        presentDays,
        lopDays,

	    basic: calc.basic,
	    hra: calc.hra,
	specialAllowance: calc.specialAllowance,
        pf: calc.pf,
        pt: calc.pt,        leaveDeduction: calc.leaveDeduction,

        grossSalary: calc.gross,
        deductions: calc.deductions,
        netSalary: calc.netSalary,
      },
    });
  }

  /* HR UPDATE */

  async updatePayroll(payrollId: number, data: any) {
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

  async getPayroll(employeeId: number) {
    if (!employeeId) {
      throw new BadRequestException('Invalid employee ID');
    }

    return this.prisma.payroll.findMany({
      where: { employeeId },
      include: { salary: true },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
      ],
    });
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

    const payrollRecords = await this.prisma.payroll.findMany({
      where: { employeeId },
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

    const newDeductions =
      payroll.deductions + (normalizedType === 'DEDUCTION' ? numericAmount : 0);
    const newGross =
      payroll.grossSalary + (normalizedType === 'ALLOWANCE' ? numericAmount : 0);
    const newNet = newGross - newDeductions;

    await this.prisma.payrollAdjustment.create({
      data: {
        payrollId: normalizedPayrollId,
        name: normalizedName,
        type: normalizedType as 'ALLOWANCE' | 'DEDUCTION',
        amount: numericAmount,
      },
    });

    return this.prisma.payroll.update({
      where: { id: normalizedPayrollId },
      data: {
        grossSalary: newGross,
        deductions: newDeductions,
        netSalary: newNet,
      },
    });
  }
}