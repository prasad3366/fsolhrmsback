import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { HolidaysModule } from '../../holidays/holidays.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AuditService } from './audit.service';
import { AttendancePolicyService } from './services/attendance-policy.service';
import { LeavePolicyService } from './services/leave-policy.service';
import { SecurityPolicyService } from './services/security-policy.service';
import { WorkflowPolicyService } from './services/workflow-policy.service';

@Module({
  imports: [AuthModule, HolidaysModule, PrismaModule],
  controllers: [SettingsController],
  providers: [
    SettingsService,
    AuditService,
    AttendancePolicyService,
    LeavePolicyService,
    SecurityPolicyService,
    WorkflowPolicyService,
  ],
  exports: [
    SettingsService,
    AuditService,
    AttendancePolicyService,
    LeavePolicyService,
    SecurityPolicyService,
    WorkflowPolicyService,
  ],
})
export class SettingsModule {}
