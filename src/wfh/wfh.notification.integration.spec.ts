import { ActionType, NotificationEntityType } from '@prisma/client';
import { WfhService } from './wfh.service';

describe('WFH notification integration', () => {
  it('creates pending ActionItems and notifications for the correct approvers', async () => {
    const notificationService = {
      createActionItem: jest.fn().mockResolvedValue({ id: 1 }),
      createNotification: jest.fn().mockResolvedValue({ id: 9 }),
    } as any;

    const prisma = {
      wFHRequest: {
        findUnique: jest.fn().mockResolvedValue({ employeeId: 7, id: 88 }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 88, employeeId: 7, status: 'PENDING' }),
      },
      employee: {
        findMany: jest.fn().mockResolvedValue([
          { id: 10, userId: 100, user: { id: 100, role: 'IT_MANAGER' } },
          { id: 11, userId: 101, user: { id: 101, role: 'HR' } },
        ]),
      },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    } as any;

    const authorizationService = {
      canManageWfhRequest: jest.fn().mockResolvedValue(true),
    } as any;

    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue([new Date(2026, 8, 4)]),
    } as any;

    const service = new WfhService(prisma, workingDaysService, authorizationService, notificationService);

    await service.request(7, {
      startDate: '2026-09-04',
      endDate: '2026-09-04',
      reason: 'Remote work',
    } as any);

    expect(notificationService.createActionItem).toHaveBeenCalledTimes(2);
    expect(notificationService.createActionItem).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 100,
      entityType: NotificationEntityType.WFH,
      entityId: 88,
      actionType: ActionType.REVIEW,
    }));
    expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 100,
      entityType: NotificationEntityType.WFH,
      entityId: 88,
    }));
  });

  it('routes WFH approval pool by existing WFH authorization rules', async () => {
    const prisma = {
      wFHRequest: { findUnique: jest.fn().mockResolvedValue({ employeeId: 7, id: 88 }) },
      employee: {
        findMany: jest.fn().mockResolvedValue([
          { id: 10, userId: 100, user: { id: 100, role: 'IT_MANAGER' } },
          { id: 11, userId: 101, user: { id: 101, role: 'HR' } },
          { id: 12, userId: 102, user: { id: 102, role: 'SUPER_ADMIN' } },
        ]),
      },
    } as any;

    const authorizationService = {
      canManageWfhRequest: jest.fn(async (user: any) => ['IT_MANAGER', 'HR', 'SUPER_ADMIN'].includes(user.role)),
    } as any;

    const service = new WfhService(prisma as any, {} as any, authorizationService, {} as any);
    const result = await (service as any).resolveWfhApprovalPool(88);

    expect(result.map((approver: any) => approver.role)).toEqual(['IT_MANAGER', 'HR', 'SUPER_ADMIN']);
  });

  it('blocks manager approval when the actor and target employee are the same person', async () => {
    const prisma = {
      wFHRequest: {
        findUnique: jest.fn().mockResolvedValue({ employeeId: 10 }),
      },
    } as any;

    const authorizationService = new (require('../common/authorization/authorization.service').AuthorizationService)(prisma);
    await expect(
      authorizationService.canManageWfhRequest({ id: 1, role: 'IT_MANAGER', employeeId: 10 }, 5),
    ).resolves.toBe(false);
  });

  it('approval resolves all pending WFH ActionItems and notifies the requester', async () => {
    const notificationService = {
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 2 }),
      createNotification: jest.fn().mockResolvedValue({ id: 10 }),
    } as any;

    const prisma = {
      $transaction: jest.fn(async (callback: any) => {
        const tx = {
          wFHRequest: {
            findUnique: jest.fn().mockResolvedValue({ id: 15, employeeId: 7, status: 'PENDING', startDate: new Date(2026, 8, 4), endDate: new Date(2026, 8, 4) }),
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn().mockResolvedValue({ id: 15, status: 'APPROVED' }),
          },
        };
        return callback(tx);
      }),
      wFHRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 15,
          employeeId: 7,
          status: 'APPROVED',
          employee: { userId: 42 },
        }),
      },
    } as any;

    const service = new WfhService(prisma, {} as any, {} as any, notificationService);
    await service.approve(15);

    expect(notificationService.resolveActionItemsForEntity).toHaveBeenCalledWith({
      entityType: NotificationEntityType.WFH,
      entityId: 15,
    });
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 42,
      entityType: NotificationEntityType.WFH,
      entityId: 15,
    }));
  });

  it('rejection resolves all pending WFH ActionItems and notifies the requester', async () => {
    const notificationService = {
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 2 }),
      createNotification: jest.fn().mockResolvedValue({ id: 11 }),
    } as any;

    const prisma = {
      wFHRequest: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 19, employeeId: 7, status: 'PENDING' })
          .mockResolvedValueOnce({
            id: 19,
            employeeId: 7,
            status: 'REJECTED',
            employee: { userId: 42 },
          }),
        update: jest.fn().mockResolvedValue({ id: 19, status: 'REJECTED' }),
      },
    } as any;

    const service = new WfhService(prisma, {} as any, {} as any, notificationService);
    await service.reject(19);

    expect(notificationService.resolveActionItemsForEntity).toHaveBeenCalledWith({
      entityType: NotificationEntityType.WFH,
      entityId: 19,
    });
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 42,
      message: expect.stringContaining('rejected'),
    }));
  });

  it('does not create another final decision notification after the request is finalized', async () => {
    const notificationService = {
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 2 }),
      createNotification: jest.fn().mockResolvedValue({ id: 12 }),
    } as any;

    const prisma = {
      $transaction: jest.fn(async (callback: any) => {
        const tx = {
          wFHRequest: {
            findUnique: jest.fn().mockResolvedValue({ id: 21, employeeId: 7, status: 'APPROVED', startDate: new Date(2026, 8, 4), endDate: new Date(2026, 8, 4) }),
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return callback(tx);
      }),
      wFHRequest: { findUnique: jest.fn().mockResolvedValue({ id: 21, employeeId: 7, status: 'APPROVED', employee: { userId: 42 } }) },
    } as any;

    const service = new WfhService(prisma, {} as any, {} as any, notificationService);

    await expect(service.approve(21)).rejects.toThrow('Cannot approve request with status APPROVED');
    expect(notificationService.createNotification).not.toHaveBeenCalled();
  });

  it('prevents duplicate pending WFH ActionItems for the same recipient and entity', async () => {
    const notificationService = {
      createActionItem: jest.fn().mockRejectedValue(new Error('duplicate pending ActionItem')),
    } as any;

    const service = new WfhService({} as any, {} as any, {} as any, notificationService);

    await expect(notificationService.createActionItem({
      recipientUserId: 100,
      entityType: NotificationEntityType.WFH,
      entityId: 88,
      actionType: ActionType.REVIEW,
    })).rejects.toThrow('duplicate pending ActionItem');
  });

  it('approved WFH does not create or modify attendance records', async () => {
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback({
        wFHRequest: {
          findUnique: jest.fn().mockResolvedValue({ id: 30, employeeId: 7, status: 'PENDING', startDate: new Date(2026, 8, 4), endDate: new Date(2026, 8, 4) }),
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue({ id: 30, status: 'APPROVED' }),
        },
      })),
      wFHRequest: { findUnique: jest.fn().mockResolvedValue({ id: 30, employeeId: 7, status: 'APPROVED', employee: { userId: 42 } }) },
      attendanceRecord: { create: jest.fn(), update: jest.fn() },
    } as any;

    const service = new WfhService(prisma, {} as any, {} as any, { resolveActionItemsForEntity: jest.fn(), createNotification: jest.fn() } as any);
    await service.approve(30);

    expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
  });
});
