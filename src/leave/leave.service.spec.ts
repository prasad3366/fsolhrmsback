import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';

describe('LeaveService.requestCarryForward', () => {
  let prisma: any;
  let service: LeaveService;

  beforeEach(() => {
    prisma = {
      employee: {
        findUnique: jest.fn(),
      },
      leaveBalance: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new LeaveService(prisma, {} as any);
  });

  it('applies carry-forward immediately for a valid balance', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 8 });
    prisma.leaveBalance.findUnique.mockResolvedValue({
      employeeId: 8,
      leaveTypeId: 5,
      yearStart: 2026,
      allocated: 10,
      carryForward: 2,
      used: 3,
      leaveType: { carryForward: true, maxCarryLimit: 8 },
    });
    prisma.leaveBalance.update.mockResolvedValue({
      employeeId: 8,
      leaveTypeId: 5,
      yearStart: 2026,
      carryForward: 8,
    });

    await expect(service.requestCarryForward(8, 5, 2026)).resolves.toEqual({
      message: 'Carry forward requested successfully',
    });

    expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
      where: {
        employeeId_leaveTypeId_yearStart: {
          employeeId: 8,
          leaveTypeId: 5,
          yearStart: 2026,
        },
      },
      data: {
        carryForward: 8,
      },
    });
  });

  it('rejects invalid financial-year targets', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 8 });

    await expect(service.requestCarryForward(8, 5, 2025)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects carry-forward when there is no positive balance to carry', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 8 });
    prisma.leaveBalance.findUnique.mockResolvedValue({
      employeeId: 8,
      leaveTypeId: 5,
      yearStart: 2026,
      allocated: 5,
      carryForward: 0,
      used: 10,
      leaveType: { carryForward: true, maxCarryLimit: 8 },
    });

    await expect(service.requestCarryForward(8, 5, 2026)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects missing employees before mutating leave balances', async () => {
    prisma.employee.findUnique.mockResolvedValue(null);

    await expect(service.requestCarryForward(999, 5, 2026)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('LeaveService working-day calculation', () => {
  const leaveType = {
    id: 5,
    yearlyQuota: 20,
    requiresMedical: false,
  };

  const createService = (workingDates: Date[]) => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, user: {} }) },
      leaveType: { findUnique: jest.fn().mockResolvedValue(leaveType) },
      leave: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({ allocated: 20, carryForward: 0, used: 0 }),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    } as any;
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue(workingDates),
    } as any;

    return {
      service: new LeaveService(prisma, {} as any, undefined as any, workingDaysService),
      prisma,
      workingDaysService,
    };
  };

  it('stores eligible working days for a full-day request and uses them for balance validation', async () => {
    const workingDates = [new Date(2026, 8, 4), new Date(2026, 8, 7)];
    const { service, prisma } = createService(workingDates);

    await service.applyLeave(7, {
      leaveTypeId: 5,
      startDate: '2026-09-04',
      endDate: '2026-09-07',
      durationType: 'FULL_DAY',
      reason: 'Personal leave',
    } as any);

    expect(prisma.leave.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalDays: 2 }),
    });
  });

  it('preserves half-day as 0.5 without multiplying it by the date span', async () => {
    const workingDate = new Date(2026, 8, 4);
    const { service, prisma } = createService([workingDate]);

    await service.applyLeave(7, {
      leaveTypeId: 5,
      startDate: '2026-09-04',
      endDate: '2026-09-04',
      durationType: 'HALF_DAY_FIRST',
      reason: 'Personal leave',
    } as any);

    expect(prisma.leave.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalDays: 0.5 }),
    });
  });

  it('rejects a half-day when no eligible working date exists', async () => {
    const { service, prisma } = createService([]);

    await expect(service.applyLeave(7, {
      leaveTypeId: 5,
      startDate: '2026-09-06',
      endDate: '2026-09-06',
      durationType: 'HALF_DAY_FIRST',
      reason: 'Personal leave',
    } as any)).rejects.toThrow('Half-day leave must be on a working day');

    expect(prisma.leave.create).not.toHaveBeenCalled();
  });

  it('rejects a full-day range containing no eligible working day', async () => {
    const { service, prisma } = createService([]);

    await expect(service.applyLeave(7, {
      leaveTypeId: 5,
      startDate: '2026-09-05',
      endDate: '2026-09-06',
      durationType: 'FULL_DAY',
      reason: 'Personal leave',
    } as any)).rejects.toThrow('Leave must include a working day');

    expect(prisma.leave.create).not.toHaveBeenCalled();
  });

  it.each([
    ['normal', null, 0],
    ['Sales', 'SALES', 1],
  ])('stores the correct Saturday total for a %s employee', async (_label, teamName, expectedTotalDays) => {
    const holidayService = { isHoliday: jest.fn().mockResolvedValue(null) } as any;
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          user: {},
          team: teamName ? { name: teamName } : null,
        }),
      },
      leaveType: { findUnique: jest.fn().mockResolvedValue(leaveType) },
      leave: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({ allocated: 20, carryForward: 0, used: 0 }),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    } as any;
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    const workingDaysService = new WorkingDaysService(prisma, holidayService);
    const service = new LeaveService(prisma, holidayService, undefined as any, workingDaysService);

    const request = service.applyLeave(7, {
      leaveTypeId: 5,
      startDate: '2026-09-05',
      endDate: '2026-09-05',
      durationType: 'FULL_DAY',
      reason: 'Personal leave',
    } as any);

    if (expectedTotalDays === 0) {
      await expect(request).rejects.toThrow('Leave must include a working day');
    } else {
      await expect(request).resolves.toEqual({ id: 1 });
      expect(prisma.leave.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ totalDays: expectedTotalDays }),
      });
    }
  });
});

describe('LeaveService L5 validation', () => {
  const validLeave = {
    leaveTypeId: 5,
    startDate: '2026-09-04',
    endDate: '2026-09-04',
    durationType: 'FULL_DAY',
    reason: 'Personal leave',
  } as any;

  const createApplicationService = () => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, user: {} }) },
      leaveType: { findUnique: jest.fn().mockResolvedValue({ yearlyQuota: 20, requiresMedical: false }) },
      leave: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({ allocated: 20, carryForward: 0, used: 0 }),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    } as any;
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    const workingDaysService = {
      getWorkingDates: jest.fn().mockResolvedValue([new Date(2026, 8, 4)]),
    } as any;
    return {
      service: new LeaveService(prisma, {} as any, undefined as any, workingDaysService),
      prisma,
    };
  };

  const createRejectionService = () => {
    const prisma = {
      leave: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 15, employeeId: 7, status: 'PENDING' })
          .mockResolvedValueOnce({ id: 15, status: 'REJECTED' }),
        update: jest.fn(),
      },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 10 }) },
    } as any;
    return { service: new LeaveService(prisma, {} as any), prisma };
  };

  it.each(['', '   '])('rejects an empty or whitespace-only reason', async (reason) => {
    const { service, prisma } = createApplicationService();

    await expect(service.applyLeave(7, { ...validLeave, reason })).rejects.toThrow('Reason is required');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an overlong reason and accepts a valid reason', async () => {
    const overlong = 'x'.repeat(501);
    const invalid = createApplicationService();
    await expect(invalid.service.applyLeave(7, { ...validLeave, reason: overlong })).rejects.toThrow('Reason is too long');

    const valid = createApplicationService();
    await expect(valid.service.applyLeave(7, validLeave)).resolves.toEqual({ id: 1 });
  });

  it.each([
    ['start', { ...validLeave, startDate: 'not-a-date' }],
    ['end', { ...validLeave, endDate: 'not-a-date' }],
    ['Date object', { ...validLeave, startDate: new Date(Number.NaN) }],
  ])('rejects a malformed %s date at the service boundary', async (_label, request) => {
    const { service, prisma } = createApplicationService();

    await expect(service.applyLeave(7, request as any)).rejects.toThrow('Invalid date format');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('preserves start-after-end validation', async () => {
    const { service } = createApplicationService();

    await expect(service.applyLeave(7, {
      ...validLeave,
      startDate: '2026-09-05',
      endDate: '2026-09-04',
    })).rejects.toThrow('Invalid date range');
  });

  it('rejects invalid direct-service duration values while preserving omitted and half-day behavior', async () => {
    const invalid = createApplicationService();
    await expect(invalid.service.applyLeave(7, { ...validLeave, durationType: 'INVALID' })).rejects.toThrow('Invalid duration type');

    const omitted = createApplicationService();
    await expect(omitted.service.applyLeave(7, { ...validLeave, durationType: undefined })).resolves.toEqual({ id: 1 });

    const secondHalf = createApplicationService();
    await expect(secondHalf.service.applyLeave(7, {
      ...validLeave,
      durationType: 'HALF_DAY_SECOND',
    })).resolves.toEqual({ id: 1 });
    expect(secondHalf.prisma.leave.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalDays: 0.5 }),
    });
  });

  it.each([
    ['', 'Rejection remarks are required'],
    ['   ', 'Rejection remarks are required'],
    [123, 'Rejection remarks are required'],
    ['x'.repeat(501), 'Rejection remarks are too long'],
  ])('rejects invalid rejection remarks', async (remarks, message) => {
    const { service, prisma } = createRejectionService();

    await expect(service.rejectLeave(15, remarks as any, 10, 'HR')).rejects.toThrow(message);
    expect(prisma.leave.findUnique).not.toHaveBeenCalled();
  });

  it('preserves successful rejection with valid remarks', async () => {
    const { service, prisma } = createRejectionService();

    await expect(service.rejectLeave(15, 'Not approved', 10, 'HR')).resolves.toEqual(
      expect.objectContaining({ status: 'REJECTED' }),
    );
    expect(prisma.leave.update).toHaveBeenCalledWith({
      where: { id: 15 },
      data: { status: 'REJECTED', remarks: 'Not approved' },
    });
  });
});

describe('LeaveService manager-scoped approval', () => {
  const leave = {
    id: 15,
    employeeId: 77,
    leaveTypeId: 5,
    yearStart: 2026,
    totalDays: 2,
    status: 'PENDING',
  };

  const createService = (
    role: string,
    canAccessEmployee = true,
    finalStatus: 'APPROVED' | 'REJECTED' = 'APPROVED',
  ) => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValue(canAccessEmployee),
    } as any;
    const prisma = {
      leave: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(leave)
          .mockResolvedValueOnce({ ...leave, status: finalStatus }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 10 }) },
      $transaction: jest.fn(),
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({ allocated: 10, carryForward: 0, used: 0 }),
        update: jest.fn(),
      },
    } as any;
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));

    return {
      service: new LeaveService(prisma, {} as any, authorizationService),
      authorizationService,
      prisma,
      role,
    };
  };

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('%s can approve any employee leave', async (role) => {
    const { service, authorizationService, prisma } = createService(role);

    await expect(service.approveLeave(15, 10, role)).resolves.toEqual(
      expect.objectContaining({ status: 'APPROVED' }),
    );

    expect(authorizationService.canAccessEmployee).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER'])('%s can approve an assigned-team leave', async (role) => {
    const { service, authorizationService } = createService(role, true);

    await expect(service.approveLeave(15, 10, role)).resolves.toEqual(
      expect.objectContaining({ status: 'APPROVED' }),
    );

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(
      { id: 10, role, employeeId: 10 },
      77,
    );
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER'])('%s cannot approve an outside-team leave', async (role) => {
    const { service, authorizationService, prisma } = createService(role, false);

    await expect(service.approveLeave(15, 999, role)).rejects.toThrow(
      'Unauthorized to approve leave',
    );

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(
      { id: 999, role, employeeId: 999 },
      77,
    );
    expect(prisma.leave.updateMany).not.toHaveBeenCalled();
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it.each(['FINANCE_MANAGER', 'EMPLOYEE'])('%s remains denied', async (role) => {
    const { service, prisma } = createService(role);

    await expect(service.approveLeave(15, 10, role)).rejects.toThrow(
      'Unauthorized to approve leave',
    );

    expect(prisma.leave.updateMany).not.toHaveBeenCalled();
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('uses the stored leave owner for manager rejection and never a client target', async () => {
    const { service, authorizationService, prisma } = createService('IT_MANAGER', true, 'REJECTED');

    await expect(service.rejectLeave(15, 'Not approved', 999, 'IT_MANAGER')).resolves.toEqual(
      expect.objectContaining({ status: 'REJECTED' }),
    );

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(
      { id: 999, role: 'IT_MANAGER', employeeId: 999 },
      77,
    );
    expect(prisma.leave.update).toHaveBeenCalledWith({
      where: { id: 15 },
      data: { status: 'REJECTED', remarks: 'Not approved' },
    });
  });

  it('filters manager history by the stored leave owner before pagination', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn(async (_user: unknown, employeeId: number) => employeeId === 77),
    } as any;
    const leaves = [
      { id: 1, employeeId: 77 },
      { id: 2, employeeId: 88 },
    ];
    const prisma = {
      leave: { findMany: jest.fn().mockResolvedValue(leaves) },
    } as any;
    const service = new LeaveService(prisma, {} as any, authorizationService);

    await expect(
      service.leaveHistory('IT_MANAGER', 10, 1, 10, {
        id: 10,
        role: 'IT_MANAGER',
        employeeId: 10,
      }),
    ).resolves.toEqual({
      data: [{ id: 1, employeeId: 77 }],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['pendingRequests', 'IT_MANAGER'],
    ['allLeaveRequests', 'SALES_MANAGER'],
  ])('filters %s to the manager team', async (methodName, role) => {
    const authorizationService = {
      canAccessEmployee: jest.fn(async (_user: unknown, employeeId: number) => employeeId === 77),
    } as any;
    const leaves = [
      { id: 1, employeeId: 77 },
      { id: 2, employeeId: 88 },
    ];
    const prisma = {
      leave: { findMany: jest.fn().mockResolvedValue(leaves) },
    } as any;
    const service = new LeaveService(prisma, {} as any, authorizationService);

    const result = await (service as any)[methodName](role, {
      id: 10,
      role,
      employeeId: 10,
    });

    expect(result).toEqual([{ id: 1, employeeId: 77 }]);
    expect(authorizationService.canAccessEmployee).toHaveBeenCalledTimes(2);
  });
});

function createTransactionalApprovalHarness(
  leaveValues: any[],
  balanceValue: any,
  failBalanceUpdate = false,
  failStatusUpdate = false,
) {
  const state = {
    leaves: new Map(leaveValues.map((leave) => [leave.id, { ...leave }])),
    balance: { ...balanceValue },
  };
  let transactionTail = Promise.resolve();
  const transaction = jest.fn(async (callback: any) => {
    const previous = transactionTail;
    let release!: () => void;
    transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const transactionState = {
      leaves: new Map([...state.leaves].map(([id, leave]) => [id, { ...leave }])),
      balance: { ...state.balance },
    };
    const tx = {
      leave: {
        findUnique: jest.fn(async ({ where: { id } }: any) => transactionState.leaves.get(id) ?? null),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (failStatusUpdate) throw new Error('status update failed');
          const leave = transactionState.leaves.get(where.id);
          if (!leave || leave.status !== where.status) return { count: 0 };
          transactionState.leaves.set(where.id, { ...leave, ...data });
          return { count: 1 };
        }),
        update: jest.fn(),
      },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 10, user: {} }) },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue(transactionState.balance),
        update: jest.fn(async ({ data }: any) => {
          if (failBalanceUpdate) throw new Error('balance update failed');
          transactionState.balance.used += data.used.increment;
          return transactionState.balance;
        }),
      },
    };

    try {
      const result = await callback(tx);
      state.leaves = transactionState.leaves;
      state.balance = transactionState.balance;
      return result;
    } finally {
      release();
    }
  });
  const prisma = { $transaction: transaction } as any;
  return { state, prisma };
}

function createTransactionalApplicationHarness(existingLeaves: any[] = []) {
  const state = { leaves: existingLeaves.map((leave) => ({ ...leave })), nextId: 10 };
  let transactionTail = Promise.resolve();
  const transaction = jest.fn(async (callback: any) => {
    const previous = transactionTail;
    let release!: () => void;
    transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const transactionLeaves = state.leaves.map((leave) => ({ ...leave }));
    const tx = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, user: {} }) },
      leaveType: { findUnique: jest.fn().mockResolvedValue({ yearlyQuota: 10, requiresMedical: false }) },
      leave: {
        findFirst: jest.fn(async ({ where }: any) => transactionLeaves.find((leave) =>
          leave.employeeId === where.employeeId &&
          leave.status !== 'REJECTED' &&
          leave.startDate <= where.endDate.gte &&
          leave.endDate >= where.startDate.lte,
        ) ?? null),
        create: jest.fn(async ({ data }: any) => {
          const created = { id: state.nextId++, ...data };
          transactionLeaves.push(created);
          return created;
        }),
      },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({ allocated: 10, carryForward: 0, used: 0 }),
        create: jest.fn().mockResolvedValue({ allocated: 10, carryForward: 0, used: 0 }),
      },
    };

    try {
      const result = await callback(tx);
      state.leaves = transactionLeaves;
      return result;
    } finally {
      release();
    }
  });
  return { state, prisma: { $transaction: transaction } as any };
}

describe('LeaveService L4 concurrency integrity', () => {
  const leave = {
    id: 1,
    employeeId: 7,
    leaveTypeId: 5,
    yearStart: 2026,
    totalDays: 2,
    status: 'PENDING',
  };
  const authorizationService = { canAccessEmployee: jest.fn() } as any;

  it('allows only one sequential approval and consumes balance once', async () => {
    const harness = createTransactionalApprovalHarness([leave], { allocated: 2, carryForward: 0, used: 0 });
    const service = new LeaveService(harness.prisma, {} as any, authorizationService);

    await expect(service.approveLeave(1, 10, 'HR')).resolves.toEqual(expect.objectContaining({ status: 'APPROVED' }));
    await expect(service.approveLeave(1, 10, 'HR')).rejects.toThrow('Leave already processed');

    expect(harness.state.leaves.get(1)?.status).toBe('APPROVED');
    expect(harness.state.balance.used).toBe(2);
  });

  it('allows exactly one of two concurrent approvals for the same leave', async () => {
    const harness = createTransactionalApprovalHarness([leave], { allocated: 2, carryForward: 0, used: 0 });
    const service = new LeaveService(harness.prisma, {} as any, authorizationService);

    const results = await Promise.allSettled([
      service.approveLeave(1, 10, 'HR'),
      service.approveLeave(1, 10, 'HR'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(harness.state.leaves.get(1)?.status).toBe('APPROVED');
    expect(harness.state.balance.used).toBe(2);
  });

  it('prevents competing approvals from over-consuming a shared balance', async () => {
    const harness = createTransactionalApprovalHarness([
      leave,
      { ...leave, id: 2, totalDays: 1 },
    ], { allocated: 2, carryForward: 0, used: 0 });
    const service = new LeaveService(harness.prisma, {} as any, authorizationService);

    const results = await Promise.allSettled([
      service.approveLeave(1, 10, 'HR'),
      service.approveLeave(2, 10, 'HR'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(harness.state.balance.used).toBe(2);
    expect(harness.state.balance.used).toBeLessThanOrEqual(2);
  });

  it('rolls back Leave status when balance update fails', async () => {
    const harness = createTransactionalApprovalHarness([leave], { allocated: 2, carryForward: 0, used: 0 }, true);
    const service = new LeaveService(harness.prisma, {} as any, authorizationService);

    await expect(service.approveLeave(1, 10, 'HR')).rejects.toThrow('balance update failed');
    expect(harness.state.leaves.get(1)?.status).toBe('PENDING');
    expect(harness.state.balance.used).toBe(0);
  });

  it('does not consume balance when the conditional status update affects zero rows', async () => {
    const harness = createTransactionalApprovalHarness([leave], { allocated: 2, carryForward: 0, used: 0 });
    const service = new LeaveService(harness.prisma, {} as any, authorizationService);

    harness.state.leaves.get(1)!.status = 'APPROVED';
    await expect(service.approveLeave(1, 10, 'HR')).rejects.toThrow('Leave already processed');
    expect(harness.state.balance.used).toBe(0);
  });

  it('does not change balance when the status update fails', async () => {
    const harness = createTransactionalApprovalHarness(
      [leave],
      { allocated: 2, carryForward: 0, used: 0 },
      false,
      true,
    );
    const service = new LeaveService(harness.prisma, {} as any, authorizationService);

    await expect(service.approveLeave(1, 10, 'HR')).rejects.toThrow('status update failed');
    expect(harness.state.leaves.get(1)?.status).toBe('PENDING');
    expect(harness.state.balance.used).toBe(0);
  });

  it('prevents two concurrent overlapping applications from both creating Leave records', async () => {
    const harness = createTransactionalApplicationHarness();
    const workingDaysService = { getWorkingDates: jest.fn().mockResolvedValue([new Date(2026, 8, 4)]) } as any;
    const service = new LeaveService(harness.prisma, {} as any, authorizationService, workingDaysService);
    const request = {
      leaveTypeId: 5,
      startDate: '2026-09-04',
      endDate: '2026-09-04',
      durationType: 'FULL_DAY',
      reason: 'Personal leave',
    } as any;

    const results = await Promise.allSettled([
      service.applyLeave(7, request),
      service.applyLeave(7, request),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(harness.state.leaves).toHaveLength(1);
  });
});
