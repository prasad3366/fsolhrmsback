import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { ActionType, NotificationEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWfhDto } from './dto/wfh-request.dto';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { NotificationService } from '../modules/notifications/notification.service';

@Injectable()
export class WfhService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workingDaysService: WorkingDaysService,
    private readonly authorizationService: AuthorizationService = new AuthorizationService(prisma),
    private readonly notificationService: NotificationService = new NotificationService(prisma),
  ) {}

  private parseBusinessDate(value: string): Date {
    if (typeof value !== 'string') {
      throw new BadRequestException('Invalid date format');
    }

    const datePart = value.slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);

    if (!match || Number.isNaN(new Date(value).getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const [, yearText, monthText, dayText] = match;
    const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));

    if (
      date.getFullYear() !== Number(yearText) ||
      date.getMonth() !== Number(monthText) - 1 ||
      date.getDate() !== Number(dayText)
    ) {
      throw new BadRequestException('Invalid date format');
    }

    return date;
  }

  private getDateRange(start: Date, end: Date): Date[] {
    const dates: Date[] = [];

    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      dates.push(new Date(date));
    }

    return dates;
  }

  private isSerializationConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2034'
    );
  }

  private async resolveWfhApprovalPool(requestId: number) {
    const request = await this.prisma.wFHRequest.findUnique({
      where: { id: requestId },
      select: { employeeId: true },
    });

    if (!request) {
      return [] as Array<{ userId: number; role: string; employeeId: number }>;
    }

    const candidates = await this.prisma.employee.findMany({
        select: {
          id: true,
          userId: true,
          user: { select: { role: true } },
        },
      where: {
        user: {
            role: {
              in: ['SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER'],
          },
        },
      },
    });

    const eligible: Array<{ userId: number; role: string; employeeId: number }> = [];

    for (const candidate of candidates) {
      if (!candidate.userId) {
        continue;
      }

      const actor = {
        id: candidate.userId,
        role: candidate.user?.role ?? '',
        employeeId: candidate.id,
      };

      const allowed = await this.authorizationService.canManageWfhRequest(actor, requestId);
      if (allowed) {
        eligible.push({
          userId: candidate.userId,
          role: candidate.user.role,
          employeeId: candidate.id,
        });
      }
    }

    return eligible;
  }

  private async notifyWfhRequestCreated(requestId: number) {
    const approvers = await this.resolveWfhApprovalPool(requestId);

    for (const approver of approvers) {
      try {
        await this.notificationService.createActionItem({
          recipientUserId: approver.userId,
          entityType: NotificationEntityType.WFH,
          entityId: requestId,
          actionType: ActionType.REVIEW,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) {
          throw error;
        }
      }

      await this.notificationService.createNotification({
        recipientUserId: approver.userId,
        entityType: NotificationEntityType.WFH,
        entityId: requestId,
        title: 'WFH request pending approval',
        message: 'A WFH request requires your review and decision.',
      });
    }
  }

  private async notifyWfhDecision(requestId: number, decision: 'APPROVED' | 'REJECTED') {
    await this.notificationService.resolveActionItemsForEntity({
      entityType: NotificationEntityType.WFH,
      entityId: requestId,
    });

    const request = await this.prisma.wFHRequest.findUnique({
      where: { id: requestId },
      include: { employee: { include: { user: true } } },
    });

    if (!request?.employee?.userId) {
      return;
    }

    await this.notificationService.createNotification({
      recipientUserId: request.employee.userId,
      entityType: NotificationEntityType.WFH,
      entityId: requestId,
      title: `WFH request ${decision.toLowerCase()}`,
      message: `Your WFH request has been ${decision.toLowerCase()}.`,
    });
  }

  // ==================================
  // Employee → Request WFH
  // ==================================
  async request(employeeId: number, dto: RequestWfhDto) {
    const { startDate, endDate, reason } = dto;

    if (!startDate || !endDate) {
      throw new BadRequestException('Start date and End date are required');
    }

    if (reason !== undefined && (typeof reason !== 'string' || reason.trim() === '')) {
      throw new BadRequestException('Reason must be a non-empty string');
    }

    try {
      let createdRequest: any;

      createdRequest = await this.prisma.$transaction(async (tx) => {
        const start = this.parseBusinessDate(startDate);
        const end = this.parseBusinessDate(endDate);

        if (start > end) {
          throw new BadRequestException('Start date cannot be after end date');
        }

        const workingDates = await this.workingDaysService.getWorkingDates(
          employeeId,
          this.getDateRange(start, end),
        );

        if (workingDates.length === 0) {
          throw new BadRequestException('WFH request must include at least one working day');
        }

        const overlap = await tx.wFHRequest.findFirst({
          where: {
            employeeId,
            status: { in: ['PENDING', 'APPROVED'] },
            startDate: { lte: end },
            endDate: { gte: start },
          },
        });

        if (overlap) {
          throw new BadRequestException('WFH already requested for this period');
        }

        return tx.wFHRequest.create({
          data: {
            employeeId,
            startDate: start,
            endDate: end,
            reason: reason ?? null,
            status: 'PENDING',
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      await this.notifyWfhRequestCreated(createdRequest.id);
      return createdRequest;
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException('WFH request conflicts with another request');
      }
      throw error;
    }
  }

  // ==================================
  // HR → Approve WFH
  // ==================================
  async approve(requestId: number) {
    try {
      const approvedRequest = await this.prisma.$transaction(async (tx) => {
        const request = await tx.wFHRequest.findUnique({
          where: { id: requestId },
        });

        if (!request) {
          throw new BadRequestException('WFH request not found');
        }

        if (request.status !== 'PENDING') {
          throw new BadRequestException(
            `Cannot approve request with status ${request.status}`,
          );
        }

        const overlap = await tx.wFHRequest.findFirst({
          where: {
            employeeId: request.employeeId,
            id: { not: requestId },
            status: 'APPROVED',
            startDate: { lte: request.endDate },
            endDate: { gte: request.startDate },
          },
        });

        if (overlap) {
          throw new BadRequestException('WFH already approved for this period');
        }

        return tx.wFHRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED' },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      await this.notifyWfhDecision(requestId, 'APPROVED');
      return approvedRequest;
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException('WFH approval conflicts with another request');
      }
      throw error;
    }
  }

  // ==================================
  // HR → Reject WFH
  // ==================================
  async reject(requestId: number) {
    const request = await this.prisma.wFHRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new BadRequestException('WFH request not found');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot reject request with status ${request.status}`,
      );
    }

    const rejectedRequest = await this.prisma.wFHRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED' },
    });

    await this.notifyWfhDecision(requestId, 'REJECTED');
    return rejectedRequest;
  }

  // ==================================
  // HR → View All Requests
  // ==================================
  async getAll(teamIds?: number[]) {
    if (teamIds && teamIds.length === 0) {
      return [];
    }

    return this.prisma.wFHRequest.findMany({
      where: teamIds
        ? { employee: { teamId: { in: teamIds } } }
        : undefined,
      include: {
        employee: {
          select: {
            id: true,
            empCode: true,
            firstName: true,
            lastName: true,
            department: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==================================
  // Employee → My Requests
  // ==================================
  async getMyRequests(employeeId: number) {
    return this.prisma.wFHRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
