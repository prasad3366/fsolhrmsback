import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../audit.service';
import { UpdateWorkflowDto } from '../dto/policy.dto';

@Injectable()
export class WorkflowPolicyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  getWorkflows() {
    return this.prisma.approvalWorkflow.findMany({ orderBy: { module: 'asc' } });
  }

  async updateWorkflow(dto: UpdateWorkflowDto, reqUser: any) {
    const previous = await this.prisma.approvalWorkflow.findUnique({ where: { module: dto.module } });
    const updated = await this.prisma.approvalWorkflow.upsert({
      where: { module: dto.module },
      create: { module: dto.module, approvalLevels: dto.approvalLevels, requireComment: dto.requireComment },
      update: { approvalLevels: dto.approvalLevels, requireComment: dto.requireComment },
    });
    await this.audit.logAction({ userId: reqUser?.id, userEmail: reqUser?.email ?? 'unknown', action: 'APPROVAL_WORKFLOW_UPDATED', module: 'SETTINGS', previousVal: previous, newVal: updated });
    return updated;
  }
}
