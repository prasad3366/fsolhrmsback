import { forwardRef, Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { HolidaysModule } from '../holidays/holidays.module';
import { EmployeesModule } from '../employees/employees.module';
import { WorkingDaysService } from '../common/working-days/working-days.service';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, PrismaService, WorkingDaysService],
  imports: [HolidaysModule, forwardRef(() => EmployeesModule)],
  exports: [AttendanceService],
})
export class AttendanceModule {}
