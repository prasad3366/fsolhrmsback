import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { RunPayrollDto } from './dto/run-payroll.dto';
import { PayrollCalculator } from './payroll.calculator';

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private employeesService: EmployeesService,
  ) {}

  /* 🔥 Working Days Calculator */

  calculateWorkingDays(startDate: Date, endDate: Date, holidays: Date[]) {
    let workingDays = 0;

    for (
      let d = new Date(startDate);
      d <= endDate;
      d.setDate(d.getDate() + 1)
    ) {
      const day = d.getDay();
      const isWeekend = day === 0 || day === 6;

      const isHoliday = holidays.some(
        (h) => h.toDateString() === d.toDateString(),
      );

      if (!isWeekend && !isHoliday) {
        workingDays++;
      }
    }

    return workingDays;
  }

  /* Resolve employeeId/empCode + month/year from the request */

  private async resolveEmployeeAndPeriod(data: RunPayrollDto) {
    let employeeId = data.employeeId ? Number(data.employeeId) : undefined;
    const month = Number(data.month);
    const year = Number(data.year);

    if (!employeeId && data.empCode) {
      const employee = await this.employeesService.findByEmpCode(data.empCode);
      employeeId = employee.id;
    }

    if (!employeeId || !month || !year) {
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

    /* 🔥 Holidays */

    const holidayData = await this.prisma.holiday.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
    });

    const holidays = holidayData.map((h) => h.date);

    /* 🔥 Working Days */

    const workingDays = this.calculateWorkingDays(startDate, endDate, holidays);

    /* 🔥 Attendance */

    const attendanceRecords = await this.prisma.attendance.findMany({
      where: {
        employeeId,
        date: { gte: startDate, lte: endDate },
      },
    });

    let presentDays = 0;

    for (const att of attendanceRecords) {
      if (att.status === 'PRESENT') presentDays += 1;
      if (att.status === 'HALF_DAY') presentDays += 0.5;
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

    console.log('DEBUG: salary.monthlyCTC =', salary.monthlyCTC);
    console.log('DEBUG: salary.structure =', salary.structure);

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

  /* ADD ALLOWANCE OR DEDUCTION */

  async addOther(
    payrollId: number,
    name: string,
    type: 'ALLOWANCE' | 'DEDUCTION',
    amount: number,
  ) {
    if (!payrollId || !name || !amount) {
      throw new BadRequestException('Invalid adjustment data');
    }

    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
    });

    if (!payroll) {
      throw new BadRequestException('Payroll not found');
    }

    const newDeductions =
      payroll.deductions + (type === 'DEDUCTION' ? amount : 0);
    const newGross = payroll.grossSalary + (type === 'ALLOWANCE' ? amount : 0);
    const newNet = newGross - newDeductions;

    return this.prisma.payroll.update({
      where: { id: payrollId },
      data: {
        grossSalary: newGross,
        deductions: newDeductions,
        netSalary: newNet,
      },
    });
  }
}