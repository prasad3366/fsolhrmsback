import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollCalculator } from './payroll.calculator';
import { WorkingDaysService } from '../common/working-days/working-days.service';

@Injectable()
export class PayrollScheduler {
  private readonly logger = new Logger(PayrollScheduler.name);

  constructor(
    private prisma: PrismaService,
    private workingDaysService: WorkingDaysService,
  ) {}

  /**
   * Runs at 00:00 on the 29th of every month to auto-generate payslips
   * (Payroll records) for every active employee based on their current
   * salary structure and attendance/leave data for the pay period that
   * just closed (29th of the previous month through the 28th of this one).
   */
  @Cron('0 0 29 * *')
  async autoGeneratePayroll() {
    const now = new Date();
    // Pay period is 29th-to-28th; the run on the 29th closes out the
    // period ending the day before (the 28th).
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 1, 29);
    const month = endDate.getMonth() + 1;
    const year = endDate.getFullYear();

    this.logger.log(`Starting auto payroll generation for ${month}/${year}...`);

    const employees = await this.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      include: {
        salaries: {
          where: { effectiveFrom: { lte: endDate } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          include: { structure: true },
        },
      },
    });

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const emp of employees) {
      try {
        const salary = emp.salaries?.[0];
        if (!salary) {
          this.logger.warn(
            `Skipping employee ${emp.empCode} (ID: ${emp.id}) - no salary configured`,
          );
          skipped++;
          continue;
        }

        const existing = await this.prisma.payroll.findFirst({
          where: { employeeId: emp.id, month, year },
        });
        if (existing) {
          skipped++;
          continue;
        }

        /* Working Days */

        const dates: Date[] = [];
        for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
          dates.push(new Date(date));
        }
        const workingDays = (await this.workingDaysService.getWorkingDates(emp.id, dates)).length;

        /* Attendance */

        const attendanceRecords = await this.prisma.attendanceRecord.findMany({
          where: {
            userId: emp.userId,
            date: { gte: startDate, lte: endDate },
          },
        });

        let presentDays = 0;

        for (const att of attendanceRecords) {
          const clockIn = att?.clockIn ?? null;
          const clockOut = att?.clockOut ?? null;

          if (!clockIn || !clockOut) {
            continue;
          }

          const totalHours = Number(
            att?.totalHours ?? ((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 3600000),
          );

          if (totalHours < 4) continue;
          if (totalHours < 7) presentDays += 0.5;
          else presentDays += 1;
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
          if (leave?.status !== 'APPROVED') continue;

          // Prorate leaves spanning a month boundary so only the days
          // that fall inside this payroll month are credited.
          const overlapStart = leave.startDate < startDate ? startDate : leave.startDate;
          const overlapEnd = leave.endDate > endDate ? endDate : leave.endDate;
          const overlapDays =
            Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
          const leaveSpanDays =
            Math.floor((leave.endDate.getTime() - leave.startDate.getTime()) / 86400000) + 1;

          approvedLeaveDays += (leave?.totalDays || 0) * (overlapDays / leaveSpanDays);
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

            pf: calc?.pf || 0,
            pt: calc?.pt || 0,
            leaveDeduction: calc?.leaveDeduction || 0,

            grossSalary: calc?.gross || 0,
            deductions: calc?.deductions || 0,
            netSalary: calc?.netSalary || 0,
          },
        });

        generated++;
      } catch (error) {
        const err = error as Error;
        failed++;
        this.logger.error(
          `Failed to generate payroll for employee ${emp.empCode} (ID: ${emp.id}): ${err.message}`,
          err.stack,
        );
      }
    }

    this.logger.log(
      `Auto payroll generation complete for ${month}/${year}: ${generated} generated, ${skipped} skipped, ${failed} failed.`,
    );
  }
}
