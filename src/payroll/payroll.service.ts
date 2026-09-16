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

    /* 🔥 Canonical attendance history */

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });

    if (!employee) {
      throw new BadRequestException('Employee not found');
    }

    const attendanceHistoryResult = await this.attendanceService.getAttendanceHistory(
      employee.userId,
      month,
      year,
    );
    const attendanceHistory = Array.isArray(attendanceHistoryResult)
      ? attendanceHistoryResult
      : attendanceHistoryResult.data;

    let presentDays = 0;

    for (const record of attendanceHistory) {
      if (record.status === AttendanceStatus.PRESENT || record.status === AttendanceStatus.LATE) {
        presentDays += 1;
      } else if (record.status === AttendanceStatus.HALF_DAY) {
        presentDays += 0.5;
      }
    }

    const approvedLeaveDays = await this.prisma.leave.aggregate({
      where: {
        employeeId,
        status: 'APPROVED',
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      _sum: { paidLeaveDays: true, lopDays: true },
    });

    const paidLeaveDays = Number(approvedLeaveDays._sum?.paidLeaveDays ?? 0);
    const leaveLopDays = Number(approvedLeaveDays._sum?.lopDays ?? 0);

    /* 🔥 FINAL LOGIC */

    const payableDays = presentDays + paidLeaveDays;
    const attendanceLopDays = Math.max(workingDays - payableDays - leaveLopDays, 0);
    const lopDays = leaveLopDays + attendanceLopDays;

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