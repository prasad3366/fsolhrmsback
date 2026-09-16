import { Module } from '@nestjs/common';
import { WfhController } from './wfh.controller';
import { WfhService } from './wfh.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { HolidaysService } from '../holidays/holidays.service';
import { NotificationModule } from '../modules/notifications/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [WfhController],
  providers: [
    WfhService,
    PrismaService,
    AuthorizationService,
    WorkingDaysService,
    HolidaysService,
  ],
  exports: [WfhService],
})
export class WfhModule {}
