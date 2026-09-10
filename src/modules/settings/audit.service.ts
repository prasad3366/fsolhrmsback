import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditActionParams {
  userId?: number;
  userEmail: string;
  action: string;
  module: string;
  ipAddress?: string;
  previousVal?: unknown;
  newVal?: unknown;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async logAction(params: AuditActionParams) {
    return this.prisma.auditLog.create({
      data: {
        userId: params.userId,
        userEmail: params.userEmail,
        action: params.action,
        module: params.module,
        ipAddress: params.ipAddress,
        previousVal: this.serialize(params.previousVal),
        newVal: this.serialize(params.newVal),
      },
    });
  }

  async createLog(params: {
    module: string;
    action: string;
    userId?: number;
    userEmail: string;
    payload?: unknown;
    ipAddress?: string;
  }) {
    return this.logAction({
      module: params.module,
      action: params.action,
      userId: params.userId,
      userEmail: params.userEmail,
      ipAddress: params.ipAddress,
      newVal: params.payload,
    });
  }

  private serialize(value: unknown): string | null {
    return value === undefined || value === null ? null : JSON.stringify(value);
  }
}
