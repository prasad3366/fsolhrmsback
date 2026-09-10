import { Module } from '@nestjs/common';
import { HelpdeskController } from './helpdesk.controller';
import { HelpdeskService } from './helpdesk.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../common/authorization/authorization.service';

@Module({
  controllers: [HelpdeskController],
  providers: [HelpdeskService, PrismaService, AuthorizationService],
})
export class HelpdeskModule {}
