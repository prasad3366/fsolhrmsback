import { ConflictException, Injectable } from '@nestjs/common';
import { ActionItemStatus, ActionType, NotificationEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type NotificationEntity = keyof typeof NotificationEntityType;
export type ActionItemActionType = keyof typeof ActionType;

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async createNotification(params: {
    recipientUserId: number;
    entityType: NotificationEntityType | string;
    entityId: number;
    actorUserId?: number | null;
    title: string;
    message: string;
  }) {
    const normalizedEntityType = this.normalizeEntityType(params.entityType);

    return this.prisma.notification.create({
      data: {
        recipientUserId: params.recipientUserId,
        entityType: normalizedEntityType,
        entityId: params.entityId,
        actorUserId: params.actorUserId ?? null,
        title: params.title,
        message: params.message,
      },
    });
  }

  async markNotificationAsRead(notificationId: number, recipientUserId?: number) {
    const where: any = { id: notificationId };
    if (recipientUserId !== undefined) {
      where.recipientUserId = recipientUserId;
    }

    return this.prisma.notification.update({
      where,
      data: {
        readAt: new Date(),
      },
    });
  }

  async markAllNotificationsAsRead(recipientUserId: number) {
    return this.prisma.notification.updateMany({
      where: {
        recipientUserId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });
  }

  async createActionItem(params: {
    recipientUserId: number;
    entityType: NotificationEntityType | string;
    entityId: number;
    actionType: ActionType | string;
    status?: ActionItemStatus | string;
    actorUserId?: number | null;
  }) {
    const normalizedEntityType = this.normalizeEntityType(params.entityType);
    const normalizedActionType = this.normalizeActionType(params.actionType);
    const normalizedStatus = this.normalizeActionStatus(params.status ?? ActionItemStatus.PENDING);

    const activeDuplicate = await this.prisma.actionItem.findFirst({
      where: {
        recipientUserId: params.recipientUserId,
        entityType: normalizedEntityType,
        entityId: params.entityId,
        actionType: normalizedActionType,
        status: ActionItemStatus.PENDING,
      },
      select: { id: true },
    });

    if (activeDuplicate) {
      throw new ConflictException('An active action item for this recipient, entity and action already exists');
    }

    return this.prisma.actionItem.create({
      data: {
        recipientUserId: params.recipientUserId,
        entityType: normalizedEntityType,
        entityId: params.entityId,
        actionType: normalizedActionType,
        status: normalizedStatus,
      },
    });
  }

  async resolveActionItem(actionItemId: number, recipientUserId?: number) {
    const where: any = { id: actionItemId };
    if (recipientUserId !== undefined) {
      where.recipientUserId = recipientUserId;
    }

    return this.prisma.actionItem.update({
      where,
      data: {
        status: ActionItemStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });
  }

  async resolveActionItemsForEntity(params: {
    recipientUserId?: number;
    entityType: NotificationEntityType | string;
    entityId: number;
  }) {
    const normalizedEntityType = this.normalizeEntityType(params.entityType);
    const where: any = {
      entityType: normalizedEntityType,
      entityId: params.entityId,
    };

    if (params.recipientUserId !== undefined) {
      where.recipientUserId = params.recipientUserId;
    }

    return this.prisma.actionItem.updateMany({
      where,
      data: {
        status: ActionItemStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });
  }

  async getNotificationsForUser(recipientUserId: number, options?: { unreadOnly?: boolean }) {
    return this.prisma.notification.findMany({
      where: {
        recipientUserId,
        ...(options?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPendingActionItemsForUser(recipientUserId: number) {
    return this.prisma.actionItem.findMany({
      where: {
        recipientUserId,
        status: ActionItemStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private normalizeEntityType(value: NotificationEntityType | string): NotificationEntityType {
    if (value in NotificationEntityType) {
      return NotificationEntityType[value as keyof typeof NotificationEntityType];
    }

    const upper = String(value).trim().toUpperCase();
    if (upper in NotificationEntityType) {
      return NotificationEntityType[upper as keyof typeof NotificationEntityType];
    }

    return NotificationEntityType.OTHER as NotificationEntityType;
  }

  private normalizeActionType(value: ActionType | string): ActionType {
    if (value in ActionType) {
      return ActionType[value as keyof typeof ActionType];
    }

    const upper = String(value).trim().toUpperCase();
    if (upper in ActionType) {
      return ActionType[upper as keyof typeof ActionType];
    }

    return ActionType.OTHER;
  }

  private normalizeActionStatus(value: ActionItemStatus | string): ActionItemStatus {
    if (value in ActionItemStatus) {
      return ActionItemStatus[value as keyof typeof ActionItemStatus];
    }

    const upper = String(value).trim().toUpperCase();
    if (upper in ActionItemStatus) {
      return ActionItemStatus[upper as keyof typeof ActionItemStatus];
    }

    return ActionItemStatus.PENDING;
  }
}
