import { ConflictException } from '@nestjs/common';
import { ActionType, NotificationEntityType, RegularizationStatus } from '@prisma/client';
import { AttendanceService } from './attendance.service';

describe('Attendance regularization notification integration', () => {
  it('creates ActionItems and notifications for authorized reviewers when a regularization is created', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 1 }),
      createActionItem: jest.fn().mockResolvedValue({ id: 5 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 1 }),
    } as any;

    const prisma = {
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue({ id: 21, userId: 7, date: new Date('2026-09-10') }),
      },
      attendanceRegularization: {
        create: jest.fn().mockResolvedValue({ id: 55, userId: 7, status: RegularizationStatus.PENDING }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 2, role: 'HR' },
          { id: 3, role: 'CEO' },
        ]),
      },
    } as any;

    const service = new AttendanceService(prisma as any, {} as any, {} as any, {} as any, notificationService as any);

    await service.requestRegularization(
      {
        requestedClockIn: '2026-09-10T09:00:00.000Z',
        requestedClockOut: '2026-09-10T18:00:00.000Z',
        reason: 'Forgot punch',
      },
      7,
      'employee@example.com',
    );

    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 2,
      entityType: NotificationEntityType.ATTENDANCE_REGULARIZATION,
      entityId: 55,
    }));
    expect(notificationService.createActionItem).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 2,
      entityType: NotificationEntityType.ATTENDANCE_REGULARIZATION,
      entityId: 55,
      actionType: ActionType.REVIEW,
    }));
    expect(notificationService.createActionItem).not.toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 4,
    }));
  });

  it('only notifies the authorized reviewers and not general employees', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 1 }),
      createActionItem: jest.fn().mockResolvedValue({ id: 5 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 1 }),
    } as any;

    const prisma = {
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue({ id: 22, userId: 7, date: new Date('2026-09-10') }),
      },
      attendanceRegularization: {
        create: jest.fn().mockResolvedValue({ id: 56, userId: 7, status: RegularizationStatus.PENDING }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 2, role: 'SUPER_ADMIN' },
          { id: 3, role: 'CEO' },
        ]),
      },
    } as any;

    const service = new AttendanceService(prisma as any, {} as any, {} as any, {} as any, notificationService as any);
    await service.requestRegularization(
      {
        requestedClockIn: '2026-09-10T09:00:00.000Z',
        requestedClockOut: '2026-09-10T18:00:00.000Z',
        reason: 'Forgot punch',
      },
      7,
      'employee@example.com',
    );

    const recipients = notificationService.createNotification.mock.calls.map((call: any[]) => call[0].recipientUserId);
    expect(recipients).toContain(2);
    expect(recipients).toContain(3);
    expect(recipients).not.toContain(4);
  });

  it('approves a regularization and resolves all pending ActionItems while notifying the requester', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 10 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 1 }),
    } as any;

    const attendanceRecordUpdate = jest.fn().mockResolvedValue({ id: 21 });
    const prisma = {
      $transaction: jest.fn(async (cb) => cb({
        attendanceRegularization: {
          update: jest.fn().mockResolvedValue({ id: 77, status: RegularizationStatus.APPROVED }),
        },
        attendancePolicy: {
          upsert: jest.fn().mockResolvedValue({ id: 1, shiftStartTime: '09:00', shiftEndTime: '18:00', gracePeriodMins: 10, earlyCheckoutMins: 15 }),
        },
        attendanceRecord: {
          update: attendanceRecordUpdate,
        },
      })),
      attendanceRegularization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 77,
          userId: 9,
          status: RegularizationStatus.PENDING,
          requestedClockIn: new Date('2026-09-10T09:00:00.000Z'),
          requestedClockOut: new Date('2026-09-10T18:00:00.000Z'),
          attendanceRecordId: 21,
        }),
      },
    } as any;

    const service = new AttendanceService(prisma as any, {} as any, {} as any, {} as any, notificationService as any);
    await service.processRegularization(77, RegularizationStatus.APPROVED, 'hr@example.com');

    expect(notificationService.resolveActionItemsForEntity).toHaveBeenCalledWith({
      entityType: NotificationEntityType.ATTENDANCE_REGULARIZATION,
      entityId: 77,
    });
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 9,
      entityType: NotificationEntityType.ATTENDANCE_REGULARIZATION,
      entityId: 77,
      title: expect.stringContaining('approved'),
    }));
    expect(attendanceRecordUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects a regularization and resolves all pending ActionItems while notifying the requester', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 11 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 1 }),
    } as any;

    const prisma = {
      $transaction: jest.fn(async (cb) => cb({
        attendanceRegularization: {
          update: jest.fn().mockResolvedValue({ id: 88, status: RegularizationStatus.REJECTED }),
        },
      })),
      attendanceRegularization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 88,
          userId: 9,
          status: RegularizationStatus.PENDING,
          requestedClockIn: new Date('2026-09-10T09:00:00.000Z'),
          requestedClockOut: new Date('2026-09-10T18:00:00.000Z'),
          attendanceRecordId: 22,
        }),
      },
    } as any;

    const service = new AttendanceService(prisma as any, {} as any, {} as any, {} as any, notificationService as any);
    await service.processRegularization(88, RegularizationStatus.REJECTED, 'hr@example.com', 'not valid');

    expect(notificationService.resolveActionItemsForEntity).toHaveBeenCalledWith({
      entityType: NotificationEntityType.ATTENDANCE_REGULARIZATION,
      entityId: 88,
    });
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 9,
      entityType: NotificationEntityType.ATTENDANCE_REGULARIZATION,
      entityId: 88,
      title: expect.stringContaining('rejected'),
    }));
  });

  it('prevents a second reviewer from creating another final decision notification after finalization', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 12 }),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 1 }),
    } as any;

    const prisma = {
      $transaction: jest.fn(async (cb) => cb({
        attendanceRegularization: {
          update: jest.fn().mockResolvedValue({ id: 99, status: RegularizationStatus.APPROVED }),
        },
      })),
      attendanceRegularization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 99,
          userId: 9,
          status: RegularizationStatus.APPROVED,
          requestedClockIn: new Date('2026-09-10T09:00:00.000Z'),
          requestedClockOut: new Date('2026-09-10T18:00:00.000Z'),
          attendanceRecordId: 23,
        }),
      },
    } as any;

    const service = new AttendanceService(prisma as any, {} as any, {} as any, {} as any, notificationService as any);
    await service.processRegularization(99, RegularizationStatus.APPROVED, 'manager@example.com');

    expect(notificationService.createNotification).not.toHaveBeenCalled();
  });

  it('prevents duplicate pending attendance regularization ActionItems', async () => {
    const notificationService = {
      createNotification: jest.fn(),
      createActionItem: jest.fn().mockRejectedValue(new ConflictException('duplicate pending ActionItem')),
    } as any;

    const prisma = {
      attendanceRecord: {
        findUnique: jest.fn().mockResolvedValue({ id: 31, userId: 7, date: new Date('2026-09-10') }),
      },
      attendanceRegularization: {
        create: jest.fn().mockResolvedValue({ id: 111, userId: 7, status: RegularizationStatus.PENDING }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 2, role: 'HR' }]),
      },
    } as any;

    const service = new AttendanceService(prisma as any, {} as any, {} as any, {} as any, notificationService as any);

    await expect(service.requestRegularization({
      requestedClockIn: '2026-09-10T09:00:00.000Z',
      requestedClockOut: '2026-09-10T18:00:00.000Z',
      reason: 'Forgot punch',
    }, 7, 'employee@example.com')).resolves.toEqual({ id: 111, userId: 7, status: RegularizationStatus.PENDING });
    expect(notificationService.createActionItem).toHaveBeenCalledTimes(1);
  });

  it('does not create a separate attendance source of truth during regularization approval', async () => {
    const notificationService = {
      createNotification: jest.fn(),
      resolveActionItemsForEntity: jest.fn().mockResolvedValue({ count: 1 }),
    } as any;

    const attendanceUpdate = jest.fn().mockResolvedValue({ id: 41 });
    const prisma = {
      $transaction: jest.fn(async (cb) => cb({
        attendanceRegularization: {
          update: jest.fn().mockResolvedValue({ id: 121, status: RegularizationStatus.APPROVED }),
        },
        attendancePolicy: {
          upsert: jest.fn().mockResolvedValue({ id: 1, shiftStartTime: '09:00', shiftEndTime: '18:00', gracePeriodMins: 10, earlyCheckoutMins: 15 }),
        },
        attendanceRecord: {
          update: attendanceUpdate,
        },
      })),
      attendanceRegularization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 121,
          userId: 9,
          status: RegularizationStatus.PENDING,
          requestedClockIn: new Date('2026-09-10T09:00:00.000Z'),
          requestedClockOut: new Date('2026-09-10T18:00:00.000Z'),
          attendanceRecordId: 41,
        }),
      },
    } as any;

    const service = new AttendanceService(prisma as any, {} as any, {} as any, {} as any, notificationService as any);
    await service.processRegularization(121, RegularizationStatus.APPROVED, 'manager@example.com');

    expect(attendanceUpdate).toHaveBeenCalledTimes(1);
    expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
  });
});
