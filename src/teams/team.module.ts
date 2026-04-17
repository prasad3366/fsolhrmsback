import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { TeamRepository } from './team.repository';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [AuthModule],
  controllers: [TeamController],
  providers: [TeamService, TeamRepository, PrismaService],
})
export class TeamModule {}