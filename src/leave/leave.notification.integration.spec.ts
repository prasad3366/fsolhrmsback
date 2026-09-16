import { ActionType, NotificationEntityType } from '@prisma/client';
import { LeaveService } from './leave.service';

describe('LeaveService notification integration', () => {
  const leaveRequest = {
    leaveTypeId: 5,
    startDate: '2026-09-04',
    endDate: '2026-09-04',
    durationType: 'FULL_DAY',
    reason: 'Personal leave',
  } as any;

  it('creates pending ActionItems and notifications for the correct approval pool', async () => {
    const notificationService = {
      createActionItem: jest.fn().mockResolvedValue({ id: 1 }),
      createNotification: jest.fn().mockResolvedValue({ id: 10 }),
    } as any;

    const targetEmployee = {
      id: 7,
      userId: 40,
      user: { id: 40, role: 'EMPLOYEE' },
      team: { name: 'IT' },
    };

    const approvers = [
      { id: 11, userId: 111, user: { id: 111, role: 'IT_MANAGER' } },
      { id: 12, userId: 112, user: { id: 112, role: 'HR' } },
      { id: 13, userId: 113, user: { id: 113, role: 'SUPER_ADMIN' } },
    ];

    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue(targetEmployee),
        findMany: jest.fn().mockResolvedValue(approvers),
      },
      leaveType: { findUnique: jest.fn().mockResolvedValue({ id: 5, name: 'Annual', yearlyQuota: 20, requiresMedical: false }) },
      leave: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 88, employeeId: 7, leaveTypeId: 5, totalDays: 1, status: 'PENDING' }),
      },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ employeeId: 7, leaveTypeId: 5, yearStart: 2026, allocated: 20, carryForward: 0, used: 0 }),
      },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    } as any;

    const authorizationService = {
      canApproveOrRejectRequest: jest.fn().mockImplementation(async () => true),
    } as any;

    const service = new LeaveService(
      prisma,
      {} as any,
      authorizationService,
      { getWorkingDates: jest.fn().mockResolvedValue([new Date(2026, 8, 4)]) } as any,
      notificationService,
    );

    await service.applyLeave(7, leaveRequest);

    expect(notificationService.createActionItem).toHaveBeenCalledTimes(3);
    expect(notificationService.createActionItem).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 111,
      entityType: NotificationEntityType.LEAVE,
      entityId: 88,
      actionType: ActionType.REVIEW,
    }));
    expect(notificationService.createNotification).toHaveBeenCalledTimes(3);
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 111,
      entityType: NotificationEntityType.LEAVE,
      entityId: 88,
    }));
  });

  it('routes the approval pool according to the existing leave authorization matrix', async () => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 70, user: { role: 'EMPLOYEE' } }),
        findMany: jest.fn().mockResolvedValue([
          { id: 10, userId: 100, user: { id: 100, role: 'IT_MANAGER' } },
          { id: 11, userId: 101, user: { id: 101, role: 'HR' } },
          { id: 12, userId: 102, user: { id: 102, role: 'SUPER_ADMIN' } },
        ]),
      },
    } as any;

    const authorizationService = {
      canApproveOrRejectRequest: jest.fn(async (user: any) => user.role === 'IT_MANAGER' || user.role === 'HR' || user.role === 'SUPER_ADMIN'),
    } as any;

    const service = new LeaveService(prisma, {} as any, authorizationService, {} as any, {} as any);
    const result = await (service as any).resolveLeaveApprovalPool(7);

    expect(result.map((approver: any) => approver.role)).toEqual(['IT_MANAGER', 'HR', 'SUPER_ADMIN']);
  });

  it('resolves all pending Leave ActionItems and notifies the requester on approval', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 99 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 3 }),
    } as any;

    const prisma = {
      $transaction: jest.fn(async (callback: any) => {
        const tx = {
          leave: {
            findUnique: jest.fn().mockResolvedValue({
              id: 15,
              employeeId: 7,
              leaveTypeId: 5,
              yearStart: 2026,
              totalDays: 1,
              status: 'PENDING',
              isLossOfPay: false,
              remarks: null,
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          employee: {
            findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 40 }),
          },
          leaveBalance: {
            findUnique: jest.fn().mockResolvedValue({ allocated: 20, carryForward: 0, used: 0 }),
            update: jest.fn().mockResolvedValue({}),
          },
        };
        return callback(tx);
      }),
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 40 }),
      },
    } as any;

    const authorizationService = {
      canApproveOrRejectRequest: jest.fn().mockResolvedValue(true),
    } as any;

    const service = new LeaveService(
      prisma,
      {} as any,
      authorizationService,
      { getWorkingDates: jest.fn() } as any,
      notificationService,
    );

    await service.approveLeave(15, 10, 'HR');

    expect(notificationService.resolveActionItemsForEntity).toHaveBeenCalledWith({
      entityType: NotificationEntityType.LEAVE,
      entityId: 15,
    });
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 40,
      entityType: NotificationEntityType.LEAVE,
      entityId: 15,
    }));
  });

  it('rejects all pending Leave ActionItems and notifies the requester on rejection', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 77 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 3 }),
    } as any;

    const prisma = {
      $transaction: jest.fn(async (callback: any) => {
        const tx = {
          leave: {
            findUnique: jest.fn().mockResolvedValue({
              id: 19,
              employeeId: 7,
              leaveTypeId: 5,
              yearStart: 2026,
              totalDays: 1,
              status: 'PENDING',
              isLossOfPay: false,
              remarks: null,
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          employee: {
            findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 42 }),
          },
          leaveBalance: { findUnique: jest.fn(), update: jest.fn() },
        };
        return callback(tx);
      }),
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, userId: 42 }),
      },
    } as any;

    const authorizationService = {
      canApproveOrRejectRequest: jest.fn().mockResolvedValue(true),
    } as any;

    const service = new LeaveService(prisma, {} as any, authorizationService, {} as any, notificationService);

    await service.rejectLeave(19, 'Not approved', 10, 'HR');

    expect(notificationService.resolveActionItemsForEntity).toHaveBeenCalledWith({
      entityType: NotificationEntityType.LEAVE,
      entityId: 19,
    });
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 42,
      message: expect.stringContaining('rejected'),
    }));
  });

  it('prevents a second approver from creating another final decision notification', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 50 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 3 }),
    } as any;

    const prisma = {
      $transaction: jest.fn(async (callback: any) => {
        const tx = {
          leave: {
            findUnique: jest.fn().mockResolvedValue({
              id: 21,
              employeeId: 7,
              leaveTypeId: 5,
              yearStart: 2026,
              totalDays: 1,
              status: 'APPROVED',
              isLossOfPay: false,
              remarks: null,
            }),
            updateMany: jest.fn(),
          },
          employee: { findUnique: jest.fn() },
          leaveBalance: { findUnique: jest.fn(), update: jest.fn() },
        };
        return callback(tx);
      }),
    } as any;

    const authorizationService = { canApproveOrRejectRequest: jest.fn().mockResolvedValue(true) } as any;

    const service = new LeaveService(prisma, {} as any, authorizationService, {} as any, notificationService);

    await expect(service.approveLeave(21, 10, 'HR')).rejects.toThrow('Leave already processed');
    expect(notificationService.createNotification).not.toHaveBeenCalled();
  });

  it('prevents duplicate pending Leave ActionItems for the same recipient and entity', async () => {
    const notificationService = {
      createActionItem: jest.fn().mockRejectedValue(new Error('duplicate pending ActionItem')), 
      createNotification: jest.fn(),
    } as any;

    const service = new LeaveService({} as any, {} as any, {} as any, {} as any, notificationService);

    await expect(notificationService.createActionItem({
      recipientUserId: 111,
      entityType: NotificationEntityType.LEAVE,
      entityId: 88,
      actionType: ActionType.APPROVE,
    })).rejects.toThrow('duplicate pending ActionItem');
  });
});
