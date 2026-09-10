import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AuditService } from './audit.service';
import { AttendancePolicyService } from './services/attendance-policy.service';
import { LeavePolicyService } from './services/leave-policy.service';
import { HolidayService } from './services/holiday.service';
import { SecurityPolicyService } from './services/security-policy.service';
import { WorkflowPolicyService } from './services/workflow-policy.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SettingsController],
  providers: [
    SettingsService,
    AuditService,
    AttendancePolicyService,
    LeavePolicyService,
    HolidayService,
    SecurityPolicyService,
    WorkflowPolicyService,
  ],
  exports: [
    SettingsService,
    AuditService,
    AttendancePolicyService,
    LeavePolicyService,
    HolidayService,
    SecurityPolicyService,
    WorkflowPolicyService,
  ],
})
export class SettingsModule {}
