import { Module } from '@nestjs/common';
import { HolidaysService } from './holidays.service';
import { HolidaysController } from './holidays.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [HolidaysService, PrismaService],
  controllers: [HolidaysController],
  exports: [HolidaysService],
})
export class HolidaysModule {}
