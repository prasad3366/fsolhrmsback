import { ConflictException } from '@nestjs/common';
import { ActionItemStatus, ActionType, NotificationEntityType } from '@prisma/client';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let prisma: any;
  let service: NotificationService;

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      actionItem: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new NotificationService(prisma);
  });

  it('creates a notification', async () => {
    prisma.notification.create.mockResolvedValue({ id: 1 });

    await service.createNotification({
      recipientUserId: 7,
      entityType: NotificationEntityType.LEAVE,
      entityId: 88,
      actorUserId: 5,
      title: 'Leave submitted',
      message: 'A leave request is pending review.',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        recipientUserId: 7,
        entityType: NotificationEntityType.LEAVE,
        entityId: 88,
        actorUserId: 5,
        title: 'Leave submitted',
        message: 'A leave request is pending review.',
      },
    });
  });

  it('marks a notification as read', async () => {
    prisma.notification.update.mockResolvedValue({ id: 1, readAt: new Date() });

    const result = await service.markNotificationAsRead(1, 7);

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 1, recipientUserId: 7 },
      data: { readAt: expect.any(Date) },
    });
    expect(result.readAt).toBeTruthy();
  });

  it('marks all notifications as read for a user', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 2 });

    await service.markAllNotificationsAsRead(7);

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { recipientUserId: 7, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('creates an action item', async () => {
    prisma.actionItem.findFirst.mockResolvedValue(null);
    prisma.actionItem.create.mockResolvedValue({ id: 3 });

    await service.createActionItem({
      recipientUserId: 7,
      entityType: NotificationEntityType.WFH,
      entityId: 12,
      actionType: ActionType.REVIEW,
    });

    expect(prisma.actionItem.create).toHaveBeenCalledWith({
      data: {
        recipientUserId: 7,
        entityType: NotificationEntityType.WFH,
        entityId: 12,
        actionType: ActionType.REVIEW,
        status: ActionItemStatus.PENDING,
      },
    });
  });

  it('prevents duplicate active action items', async () => {
    prisma.actionItem.findFirst.mockResolvedValue({ id: 9 });

    await expect(
      service.createActionItem({
        recipientUserId: 7,
        entityType: NotificationEntityType.HELPDESK,
        entityId: 44,
        actionType: ActionType.APPROVE,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('resolves an action item', async () => {
    prisma.actionItem.update.mockResolvedValue({ id: 2, status: ActionItemStatus.RESOLVED });

    await service.resolveActionItem(2, 7);

    expect(prisma.actionItem.update).toHaveBeenCalledWith({
      where: { id: 2, recipientUserId: 7 },
      data: { status: ActionItemStatus.RESOLVED, resolvedAt: expect.any(Date) },
    });
  });

  it('resolves all action items for an entity', async () => {
    prisma.actionItem.updateMany.mockResolvedValue({ count: 3 });

    await service.resolveActionItemsForEntity({
      recipientUserId: 7,
      entityType: NotificationEntityType.ATTENDANCE,
      entityId: 99,
    });

    expect(prisma.actionItem.updateMany).toHaveBeenCalledWith({
      where: { recipientUserId: 7, entityType: NotificationEntityType.ATTENDANCE, entityId: 99 },
      data: { status: ActionItemStatus.RESOLVED, resolvedAt: expect.any(Date) },
    });
  });

  it('returns notifications for a recipient, optionally unread only', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 1 }]);

    await service.getNotificationsForUser(7, { unreadOnly: true });

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { recipientUserId: 7, readAt: null },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns pending action items for a user', async () => {
    prisma.actionItem.findMany.mockResolvedValue([{ id: 1, status: ActionItemStatus.PENDING }]);

    await service.getPendingActionItemsForUser(7);

    expect(prisma.actionItem.findMany).toHaveBeenCalledWith({
      where: { recipientUserId: 7, status: ActionItemStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('stores the generic entity type and id without direct domain foreign keys', async () => {
    prisma.notification.create.mockResolvedValue({ id: 1, entityType: NotificationEntityType.DOCUMENT, entityId: 222 });

    const record = await service.createNotification({
      recipientUserId: 9,
      entityType: NotificationEntityType.DOCUMENT,
      entityId: 222,
      title: 'Document updated',
      message: 'A required document was updated.',
    });

    expect(record.entityType).toBe(NotificationEntityType.DOCUMENT);
    expect(record.entityId).toBe(222);
  });
});
