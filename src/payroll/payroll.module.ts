import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { PayrollScheduler } from './payroll.scheduler';
import { PayslipService } from './payslip.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesModule } from '../employees/employees.module';

@Module({
  imports: [EmployeesModule],
  controllers: [PayrollController],

  providers: [PayrollService, PayslipService, PayrollScheduler, PrismaService],

  exports: [PayrollService],
})
export class PayrollModule {}
