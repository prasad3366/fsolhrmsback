import { Module } from '@nestjs/common';
import { WfhController } from './wfh.controller';
import { WfhService } from './wfh.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [WfhController],
  providers: [WfhService, PrismaService],
})
export class WfhModule {}
