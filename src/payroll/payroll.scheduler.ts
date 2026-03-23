import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollCalculator } from './payroll.calculator';

@Injectable()
export class PayrollScheduler {
  constructor(private prisma: PrismaService) {}

  @Cron('0 0 1 * *')
  async autoGeneratePayroll() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const employees = await this.prisma.employee.findMany({
      include: {
        salaries: { include: { structure: true } },
      },
    });

    for (const emp of employees) {
      const salary = emp.salaries?.[0];
      if (!salary) continue;

      const existing = await this.prisma.payroll.findFirst({
        where: { employeeId: emp.id, month, year },
      });
      if (existing) continue;

      /* Holidays */

      const holidayData = await this.prisma.holiday.findMany({
        where: {
          date: { gte: startDate, lte: endDate },
        },
      });

      const holidays = holidayData?.map((h) => h.date) || [];

      /* Working Days */

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

        if (!isWeekend && !isHoliday) workingDays++;
      }

      /* Attendance */

      const attendanceRecords = await this.prisma.attendance.findMany({
        where: {
          employeeId: emp.id,
          date: { gte: startDate, lte: endDate },
        },
      });

      let presentDays = 0;

      for (const att of attendanceRecords) {
        if (att?.status === 'PRESENT') presentDays += 1;
        if (att?.status === 'HALF_DAY') presentDays += 0.5;
      }

      /* Leaves */

      const leaves = await this.prisma.leave.findMany({
        where: {
          employeeId: emp.id,
          status: 'APPROVED',
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      });

      let approvedLeaveDays = 0;

      for (const leave of leaves) {
        approvedLeaveDays += leave?.totalDays || 0;
      }

      /* Final */

      const payableDays = presentDays + approvedLeaveDays;
      const lopDays = Math.max(workingDays - payableDays, 0);

      /* Calc */

      const calc = PayrollCalculator.calculate(
        salary.monthlyCTC,
        salary.structure,
        workingDays,
        lopDays,
      );

      /* Save */

      await this.prisma.payroll.create({
        data: {
          employeeId: emp.id,
          salaryId: salary.id,
          month,
          year,
          workingDays,
          presentDays,
          lopDays,

          basic: calc.basic,
          hra: calc?.hra || 0,
          specialAllowance: calc?.specialAllowance || 0,
          otherAllowance: calc?.otherAllowance || 0,

          pf: calc?.pf || 0,
          pt: calc?.pt || 0,
          leaveDeduction: calc?.leaveDeduction || 0,

          grossSalary: calc?.gross || 0,
          deductions: calc?.deductions || 0,
          netSalary: calc?.netSalary || 0,
        },
      });
    }
  }
}
