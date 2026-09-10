import { Module } from '@nestjs/common';
import { WfhController } from './wfh.controller';
import { WfhService } from './wfh.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { HolidaysService } from '../holidays/holidays.service';

@Module({
  controllers: [WfhController],
  providers: [
    WfhService,
    PrismaService,
    AuthorizationService,
    WorkingDaysService,
    HolidaysService,
  ],
})
export class WfhModule {}
