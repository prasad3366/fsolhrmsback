import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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
import { HelpdeskModule } from './helpdesk/helpdesk.module';
import { TeamModule } from './teams/team.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { RecruitmentModule } from './modules/recruitment/recruitment.module';
import { PrismaModule } from './prisma/prisma.module';
import { TrainingModule } from './modules/training/training.module';
import { AnnouncementModule } from './modules/announcement/announcement.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SettingsModule } from './modules/settings/settings.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

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
    HelpdeskModule,
    TeamModule,
    DashboardModule,
    RecruitmentModule,
    PrismaModule,
    TrainingModule,
    AnnouncementModule,
    ReportsModule,
    SettingsModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    WfhScheduler,
    EmployeeExitScheduler,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
