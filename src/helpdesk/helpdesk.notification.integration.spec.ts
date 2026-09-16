import { ConflictException } from '@nestjs/common';
import { ActionType, NotificationEntityType } from '@prisma/client';
import { HelpdeskService } from './helpdesk.service';

describe('Helpdesk notification integration', () => {
  it('creates a ticket notification and review ActionItem for authorized helpdesk approvers', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 1 }),
      createActionItem: jest.fn().mockResolvedValue({ id: 7 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 2 }),
    } as any;

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 10, employee: { id: 15 } }),
        findMany: jest.fn().mockResolvedValue([
          { id: 2, role: 'HR' },
          { id: 3, role: 'SUPER_ADMIN' },
          { id: 4, role: 'EMPLOYEE' },
        ]),
      },
      helpdeskTicket: {
        create: jest.fn().mockResolvedValue({ id: 99, userId: 10, employeeId: 15, status: 'PENDING' }),
      },
    } as any;

    const authorizationService = {
      canAccessOrganizationWide: jest.fn().mockImplementation((user, scope) => scope === 'helpdesk' && ['HR', 'SUPER_ADMIN', 'CEO'].includes(user?.role ?? '')),
    } as any;

    const service = new HelpdeskService(prisma, authorizationService, notificationService);

    await service.create(10, { issue: 'VPN issue', reason: 'Need access' } as any);

    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 2,
      entityType: NotificationEntityType.HELPDESK,
      entityId: 99,
      title: expect.stringContaining('Helpdesk'),
    }));
    expect(notificationService.createActionItem).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 2,
      entityType: NotificationEntityType.HELPDESK,
      entityId: 99,
      actionType: ActionType.REVIEW,
    }));
    expect(notificationService.createActionItem).not.toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 4,
    }));
  });

  it('routes Helpdesk notifications only to authorized helpdesk handlers and not to general employees', async () => {
    const notificationService = {
      createNotification: jest.fn(),
      createActionItem: jest.fn(),
      resolveActionItemsForEntity: jest.fn(),
    } as any;

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 10, employee: { id: 15 } }),
        findMany: jest.fn().mockResolvedValue([
          { id: 2, role: 'HR' },
          { id: 3, role: 'CEO' },
          { id: 4, role: 'EMPLOYEE' },
        ]),
      },
      helpdeskTicket: {
        create: jest.fn().mockResolvedValue({ id: 102, userId: 10, employeeId: 15, status: 'PENDING' }),
      },
    } as any;

    const authorizationService = {
      canAccessOrganizationWide: jest.fn().mockImplementation((user, scope) => scope === 'helpdesk' && ['HR', 'CEO', 'SUPER_ADMIN'].includes(user?.role ?? '')),
    } as any;

    const service = new HelpdeskService(prisma, authorizationService, notificationService);
    await service.create(10, { issue: 'Password reset', reason: 'Locked out' } as any);

    const recipients = notificationService.createNotification.mock.calls.map((call: any[]) => call[0].recipientUserId);
    expect(recipients).toContain(2);
    expect(recipients).toContain(3);
    expect(recipients).not.toContain(4);
  });

  it('resolves pending helpdesk ActionItems and notifies the requester when the ticket is approved', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 11 }),
      createActionItem: jest.fn().mockResolvedValue({ id: 22 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 1 }),
    } as any;

    const prisma = {
      helpdeskTicket: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 88, userId: 99, status: 'APPROVED' }),
      },
    } as any;

    const service = new HelpdeskService(prisma, { canAccessOrganizationWide: jest.fn().mockReturnValue(true) } as any, notificationService);
    await service.approve(88, { id: 1, role: 'HR' });

    expect(notificationService.resolveActionItemsForEntity).toHaveBeenCalledWith({
      entityType: NotificationEntityType.HELPDESK,
      entityId: 88,
    });
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 99,
      entityType: NotificationEntityType.HELPDESK,
      entityId: 88,
      title: expect.stringContaining('approved'),
    }));
  });

  it('resolves pending ActionItems and notifies the requester when the ticket is resolved', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 12 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 1 }),
    } as any;

    const prisma = {
      helpdeskTicket: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 77, userId: 50, status: 'RESOLVED' }),
      },
    } as any;

    const service = new HelpdeskService(prisma, { canAccessOrganizationWide: jest.fn().mockReturnValue(true) } as any, notificationService);
    await service.resolve(77, { id: 1, role: 'SUPER_ADMIN' });

    expect(notificationService.resolveActionItemsForEntity).toHaveBeenCalledWith({
      entityType: NotificationEntityType.HELPDESK,
      entityId: 77,
    });
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 50,
      entityType: NotificationEntityType.HELPDESK,
      entityId: 77,
      title: expect.stringContaining('resolved'),
    }));
  });

  it('prevents duplicate pending Helpdesk ActionItems for the same recipient and entity', async () => {
    const notificationService = {
      createActionItem: jest.fn().mockRejectedValue(new ConflictException('duplicate pending ActionItem')),
      createNotification: jest.fn(),
      resolveActionItemsForEntity: jest.fn(),
    } as any;

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 11, employee: { id: 22 } }),
        findMany: jest.fn().mockResolvedValue([{ id: 2, role: 'HR' }]),
      },
      helpdeskTicket: {
        create: jest.fn().mockResolvedValue({ id: 300, userId: 11, employeeId: 22, status: 'PENDING' }),
      },
    } as any;

    const service = new HelpdeskService(prisma, { canAccessOrganizationWide: jest.fn().mockReturnValue(true) } as any, notificationService);

    await expect(service.create(11, { issue: 'Printer issue', reason: 'Offline' } as any)).resolves.toEqual({
      id: 300,
      userId: 11,
      employeeId: 22,
      status: 'PENDING',
    });
    expect(notificationService.createActionItem).toHaveBeenCalledTimes(1);
  });

  it('does not create Helpdesk notifications or action items during routine reads', async () => {
    const notificationService = {
      createNotification: jest.fn(),
      createActionItem: jest.fn(),
      resolveActionItemsForEntity: jest.fn(),
    } as any;

    const prisma = {
      helpdeskTicket: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ employee: { id: 1 } }),
      },
    } as any;

    const service = new HelpdeskService(prisma, { canAccessOrganizationWide: jest.fn().mockReturnValue(true) } as any, notificationService);

    await service.getAll();
    await service.getMine(10);

    expect(notificationService.createNotification).not.toHaveBeenCalled();
    expect(notificationService.createActionItem).not.toHaveBeenCalled();
  });
});
