import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';

import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { LeaveScheduler } from './leave.scheduler';

import { PrismaService } from '../prisma/prisma.service';
import { HolidaysModule } from '../holidays/holidays.module'; // ⭐ REQUIRED
import { EmployeesModule } from '../employees/employees.module';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { NotificationModule } from '../modules/notifications/notification.module';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.trim() === '') {
  throw new Error('JWT_SECRET environment variable is required');
}

@Module({
  imports: [
    ScheduleModule.forRoot(),

    // ⭐ Import HolidaysModule so HolidaysService becomes available
    HolidaysModule,
    NotificationModule,
    forwardRef(() => EmployeesModule),

    JwtModule.register({
      secret: jwtSecret,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [LeaveController],
  providers: [LeaveService, LeaveScheduler, PrismaService, WorkingDaysService],
  exports: [LeaveService],
})
export class LeaveModule {}
