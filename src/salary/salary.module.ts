import { Module } from '@nestjs/common';
import { SalaryController } from './salary.controller';
import { SalaryService } from './salary.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesModule } from '../employees/employees.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [EmployeesModule, AuthModule],
  controllers: [SalaryController],

  providers: [SalaryService, PrismaService],
})
export class SalaryModule {}
