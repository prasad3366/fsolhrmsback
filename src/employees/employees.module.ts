import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { PrismaService } from '../prisma/prisma.service';
import { MailModule } from '../mail/mail.module';
import { AuthModule } from '../auth/auth.module'; // <-- import AuthModule
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // <-- import JwtAuthGuard

@Module({
  imports: [MailModule, AuthModule], // <-- add AuthModule here
  controllers: [EmployeesController],
  providers: [EmployeesService, PrismaService, JwtAuthGuard], // <-- add JwtAuthGuard
})
export class EmployeesModule {}
