import { Module } from '@nestjs/common';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

@Module({
  controllers: [PerformanceController],
  providers: [PerformanceService, PrismaService, AuthorizationService],
  exports: [PerformanceService],
})
export class PerformanceModule {}
