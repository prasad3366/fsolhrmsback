import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { PrismaService } from '../prisma/prisma.service';
import { MailModule } from '../mail/mail.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeSelfOrAdminGuard } from '../common/guards/employee-self-or-admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [MailModule, AuthModule],
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    PrismaService,
    JwtAuthGuard,
    RolesGuard,
    EmployeeSelfOrAdminGuard,
  ],
  exports: [EmployeesService],
})
export class EmployeesModule {}
