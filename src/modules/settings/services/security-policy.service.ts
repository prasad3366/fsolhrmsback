import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../audit.service';
import { UpdateSecurityPolicyDto } from '../dto/policy.dto';

@Injectable()
export class SecurityPolicyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  getPolicy() {
    return this.prisma.securityPolicy.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  }

  async updatePolicy(dto: UpdateSecurityPolicyDto, reqUser: any) {
    const previous = await this.getPolicy();
    const updated = await this.prisma.securityPolicy.update({ where: { id: 1 }, data: dto });
    await this.audit.logAction({ userId: reqUser?.id, userEmail: reqUser?.email ?? 'unknown', action: 'SECURITY_POLICY_UPDATED', module: 'SETTINGS', previousVal: previous, newVal: updated });
    return updated;
  }
}
