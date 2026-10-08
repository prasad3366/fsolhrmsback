import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from './payroll.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { getBusinessDateKey } from '../attendance/utils/business-date.util';

@Injectable()
export class PayrollScheduler {
  private readonly logger = new Logger(PayrollScheduler.name);

  constructor(
    private prisma: PrismaService,
    private workingDaysService: WorkingDaysService,
    private payrollService: PayrollService,
  ) {}

  private async calculateApprovedLeaveDays(
    employeeId: number,
    leaves: Array<{ startDate: Date; endDate: Date; status: string }>,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const leaveDates = new Map<string, Date>();

    for (const leave of leaves) {
      if (leave.status !== 'APPROVED') continue;

      const leaveStart = new Date(
        leave.startDate.getFullYear(),
        leave.startDate.getMonth(),
        leave.startDate.getDate(),
      );
      const leaveEnd = new Date(
        leave.endDate.getFullYear(),
        leave.endDate.getMonth(),
        leave.endDate.getDate(),
      );
      const start = leaveStart > periodStart ? leaveStart : periodStart;
      const end = leaveEnd < periodEnd ? leaveEnd : periodEnd;

      for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
        const businessDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        leaveDates.set(getBusinessDateKey(businessDate), businessDate);
      }
    }

    return (await this.workingDaysService.getWorkingDates(employeeId, [...leaveDates.values()])).length;
  }

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
    const month = endDate.getMonth() + 1;
    const year = endDate.getFullYear();

    this.logger.log(`Starting auto payroll generation for ${month}/${year}...`);

    const employees = await this.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
    });

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const emp of employees) {
      try {
        const existing = await this.prisma.payroll.findFirst({
          where: { employeeId: emp.id, month, year },
        });
        if (existing) {
          skipped++;
          continue;
        }

        await this.payrollService.runPayroll({
          employeeId: emp.id,
          month,
          year,
        });

        generated++;
      } catch (error) {
        const err = error as Error;
        if (err.message === 'Salary not configured') {
          this.logger.warn(
            `Skipping employee ${emp.empCode} (ID: ${emp.id}) - no salary configured`,
          );
          skipped++;
          continue;
        }
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
