import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AttendanceModule } from '../../attendance/attendance.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { WorkingDaysService } from '../../common/working-days/working-days.service';
import { HolidaysService } from '../../holidays/holidays.service';

@Module({
  imports: [AuthModule, AttendanceModule, PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService, AuthorizationService, WorkingDaysService, HolidaysService],
  exports: [ReportsService],
})
export class ReportsModule {}
