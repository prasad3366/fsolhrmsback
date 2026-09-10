import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../audit.service';
import { UpdateAttendancePolicyDto } from '../dto/policy.dto';

@Injectable()
export class AttendancePolicyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  getPolicy() {
    return this.prisma.attendancePolicy.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  async updatePolicy(dto: UpdateAttendancePolicyDto, reqUser: any) {
    const previous = await this.getPolicy();
    const updated = await this.prisma.attendancePolicy.update({ where: { id: 1 }, data: dto });
    await this.audit.logAction({
      userId: reqUser?.id,
      userEmail: reqUser?.email ?? 'unknown',
      action: 'ATTENDANCE_POLICY_UPDATED',
      module: 'SETTINGS',
      previousVal: previous,
      newVal: updated,
    });
    return updated;
  }
}
