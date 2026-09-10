import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { WorkingDaysService } from '../common/working-days/working-days.service';

@Module({
  imports: [AuthModule, HolidaysModule],
  controllers: [DashboardController],
  providers: [DashboardService, PrismaService, WorkingDaysService],
})
export class DashboardModule {}
