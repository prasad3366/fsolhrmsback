import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AuthModule } from './auth/auth.module';
import { EmployeesModule } from './employees/employees.module';
import { AttendanceModule } from './attendance/attendance.module';
import { WfhModule } from './wfh/wfh.module';

import { PrismaService } from './prisma/prisma.service';
import { WfhScheduler } from './scheduler/wfh.scheduler';
import { EmployeeExitScheduler } from './scheduler/employee-exit.scheduler';
import { LeaveModule } from './leave/leave.module';
import { HolidaysModule } from './holidays/holidays.module';
import { DocumentsModule } from './documents/documents.module';
import { PayrollModule } from './payroll/payroll.module';
import { SalaryModule } from './salary/salary.module';
import { AssetsModule } from './assets/assets.module';
import { TeamModule } from './teams/team.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // ⭐ Enables cron jobs
    ScheduleModule.forRoot(),

    AuthModule,
    EmployeesModule,
    AttendanceModule,
    WfhModule,
    LeaveModule,
    HolidaysModule,
    DocumentsModule,
    PayrollModule,
    SalaryModule,
    AssetsModule,
    TeamModule,
  ],
  providers: [PrismaService, WfhScheduler, EmployeeExitScheduler],
})
export class AppModule {}
