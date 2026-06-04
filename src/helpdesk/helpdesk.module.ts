import { Module } from '@nestjs/common';
import { HelpdeskController } from './helpdesk.controller';
import { HelpdeskService } from './helpdesk.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [HelpdeskController],
  providers: [HelpdeskService, PrismaService],
})
export class HelpdeskModule {}
