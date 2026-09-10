import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../common/authorization/authorization.service';

@Module({
  controllers: [AssetsController],
  providers: [AssetsService, PrismaService, AuthorizationService],
  exports: [AssetsService],
})
export class AssetsModule {}