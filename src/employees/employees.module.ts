import { forwardRef, Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { PrismaService } from '../prisma/prisma.service';
import { MailModule } from '../mail/mail.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeSelfOrAdminGuard } from '../common/guards/employee-self-or-admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { AssetsModule } from '../assets/assets.module';
import { DocumentsModule } from '../documents/documents.module';
import { PayrollModule } from '../payroll/payroll.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { LeaveModule } from '../leave/leave.module';

@Module({
  imports: [
    MailModule,
    AuthModule,
    AssetsModule,
    DocumentsModule,
    forwardRef(() => PayrollModule),
    forwardRef(() => AttendanceModule),
    forwardRef(() => LeaveModule),
  ],
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    PrismaService,
    JwtAuthGuard,
    RolesGuard,
    EmployeeSelfOrAdminGuard,
    AuthorizationService,
  ],
  exports: [EmployeesService, AuthorizationService],
})
export class EmployeesModule {}
