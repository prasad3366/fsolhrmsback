import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../audit.service';
import { UpsertLeavePolicyDto } from '../dto/policy.dto';

@Injectable()
export class LeavePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  getPolicies() {
    return this.prisma.leavePolicy.findMany({ orderBy: { leaveTypeName: 'asc' } });
  }

  async upsertPolicy(dto: UpsertLeavePolicyDto, reqUser: any) {
    const existing = await this.prisma.leavePolicy.findUnique({
      where: { code: dto.code },
    });
    const policy = await this.prisma.leavePolicy.upsert({
      where: { code: dto.code },
      create: { ...dto },
      update: { ...dto },
    });
    await this.auditService.logAction({
      userId: reqUser?.id,
      userEmail: reqUser?.email || 'system',
      action: existing ? 'LEAVE_POLICY_UPDATED' : 'LEAVE_POLICY_CREATED',
      module: 'SETTINGS',
      previousVal: existing,
      newVal: policy,
    });
    return policy;
  }

  async deletePolicy(id: number) {
    const previous = await this.prisma.leavePolicy.findUnique({ where: { id } });
    if (!previous) throw new NotFoundException('Leave policy not found');
    return this.prisma.leavePolicy.delete({ where: { id } });
  }
}
