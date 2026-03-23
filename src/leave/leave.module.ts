import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';

import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { LeaveScheduler } from './leave.scheduler';

import { PrismaService } from '../prisma/prisma.service';
import { HolidaysModule } from '../holidays/holidays.module'; // ⭐ REQUIRED

@Module({
  imports: [
    ScheduleModule.forRoot(),

    // ⭐ Import HolidaysModule so HolidaysService becomes available
    HolidaysModule,

    JwtModule.register({
      secret: process.env.JWT_SECRET || 'jwt_secret',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [LeaveController],
  providers: [LeaveService, LeaveScheduler, PrismaService],
  exports: [LeaveService],
})
export class LeaveModule {}
