import { Module } from '@nestjs/common';
import { SalaryController } from './salary.controller';
import { SalaryService } from './salary.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesModule } from '../employees/employees.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [EmployeesModule],
  controllers: [SalaryController],

  providers: [SalaryService, PrismaService, JwtAuthGuard, RolesGuard],
})
export class SalaryModule {}
