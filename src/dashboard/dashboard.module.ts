import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { LeaveModule } from '../leave/leave.module';
import { WfhModule } from '../wfh/wfh.module';

@Module({
  imports: [AuthModule, AttendanceModule, HolidaysModule, LeaveModule, WfhModule],
  controllers: [DashboardController],
  providers: [DashboardService, PrismaService, WorkingDaysService],
})
export class DashboardModule {}
