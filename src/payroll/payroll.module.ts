import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { PayrollScheduler } from './payroll.scheduler';
import { PayslipService } from './payslip.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesModule } from '../employees/employees.module';
import { AuthModule } from '../auth/auth.module';
import { forwardRef } from '@nestjs/common';
import { HolidaysModule } from '../holidays/holidays.module';
import { WorkingDaysService } from '../common/working-days/working-days.service';

@Module({
  imports: [forwardRef(() => EmployeesModule), AuthModule, HolidaysModule],
  controllers: [PayrollController],

  providers: [PayrollService, PayslipService, PayrollScheduler, PrismaService, WorkingDaysService],

  exports: [PayrollService],
})
export class PayrollModule {}
