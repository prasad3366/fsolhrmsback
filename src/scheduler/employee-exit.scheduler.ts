import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmployeeExitScheduler {
  private readonly logger = new Logger(EmployeeExitScheduler.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Runs daily at 00:00 (midnight) to deactivate credentials for employees
   * whose exit date has reached today or earlier
   */ 
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleEmployeeExitDates() {
    try {
      this.logger.log('Starting employee exit date check...');

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find all employees with exit date <= today that still have active credentials
      const employeesToDeactivate = await this.prisma.employee.findMany({
        where: {
          dateOfExit: {
            lte: today,
          },
          user: {
            isActive: true, // Only deactivate if currently active
          },
        },
        include: {
          user: true,
        },
      });

      if (employeesToDeactivate.length === 0) {
        this.logger.log('No employees found with exit date to process');
        return;
      }

      // Deactivate credentials for all matching employees
      for (const employee of employeesToDeactivate) {
        await this.prisma.user.update({
          where: { id: employee.userId },
          data: { isActive: false },
        });

        this.logger.log(
          `Deactivated credentials for employee: ${employee.firstName} ${employee.lastName} (ID: ${employee.id}) - Exit Date: ${employee.dateOfExit}`,
        );
      }

      this.logger.log(
        `Employee exit date check completed. Deactivated ${employeesToDeactivate.length} employee(s).`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Error during employee exit date check: ${err.message}`,
        err.stack,
      );
    }
  }
}
