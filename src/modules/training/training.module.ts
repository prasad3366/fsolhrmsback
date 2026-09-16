import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TrainingController],
  providers: [TrainingService, AuthorizationService],
  exports: [TrainingService],
})
export class TrainingModule {}
