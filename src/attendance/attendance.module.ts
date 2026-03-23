import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { HolidaysModule } from '../holidays/holidays.module';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, PrismaService],
  imports: [HolidaysModule],
})
export class AttendanceModule {}
