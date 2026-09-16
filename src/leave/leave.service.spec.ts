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

describe('LeaveService organization-wide pending requests', () => {
  it.each([
    ['SUPER_ADMIN', { status: 'PENDING' }],
    ['CEO', { status: 'PENDING', employeeId: { not: 10 } }],
    ['HR', { status: 'PENDING', employeeId: { not: 10 } }],
  ])('uses the organization-wide pending query for %s', async (role, where) => {
    const leaveFindMany = jest.fn().mockResolvedValue([]);
    const service = new LeaveService({ leave: { findMany: leaveFindMany } } as any, {} as any);

    await expect(service.pendingRequests(role, { id: 1, role, employeeId: 10 })).resolves.toEqual([]);
    expect(leaveFindMany).toHaveBeenCalledWith({
      where,
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'asc' },
    });
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

  it('stores eligible working days from the inclusive date range', async () => {
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

  it('stores two calendar days for a date-only two-day request', async () => {
    const { service, prisma } = createService([
      new Date(2026, 8, 10),
      new Date(2026, 8, 11),
    ]);

    await service.applyLeave(7, {
      leaveTypeId: 5,
      startDate: '2026-09-10',
      endDate: '2026-09-11',
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

  it('records paid and LOP split separately when leave exceeds balance under LOP policy', async () => {
    const workingDate = new Date(2026, 8, 4);
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 7, user: {} }) },
      leaveType: {
        findUnique: jest.fn().mockResolvedValue({
          id: 5,
          name: 'Casual Leave',
          yearlyQuota: 20,
          requiresMedical: false,
        }),
      },
      leavePolicy: {
        findFirst: jest.fn().mockResolvedValue({ annualAllocation: 20, isLossOfPay: true }),
      },
      leave: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({ allocated: 1, carryForward: 0, used: 0 }),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    } as any;
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    const service = new LeaveService(prisma, {} as any, undefined as any, {
      getWorkingDates: jest.fn().mockResolvedValue([workingDate]),
    } as any);

    await service.applyLeave(7, {
      leaveTypeId: 5,
      startDate: '2026-09-04',
      endDate: '2026-09-04',
      durationType: 'FULL_DAY',
      reason: 'Personal leave',
    } as any);

    expect(prisma.leave.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        totalDays: 1,
        paidLeaveDays: 1,
        lopDays: 0,
        isLossOfPay: false,
      }),
    });
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
    const authorizationService = {
      canApproveOrRejectRequest: jest.fn().mockResolvedValue(true),
    } as any;
    const prisma = {
      leave: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 15, employeeId: 7, status: 'PENDING' })
          .mockResolvedValueOnce({ id: 15, status: 'REJECTED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 10 }) },
      $transaction: jest.fn(),
    } as any;
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    return { service: new LeaveService(prisma, {} as any, authorizationService), prisma, authorizationService };
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
    expect(prisma.leave.updateMany).toHaveBeenCalledWith({
      where: { id: 15, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        remarks: 'Not approved',
        decisionByEmployeeId: 10,
        decisionByRole: 'HR',
        decisionAt: expect.any(Date),
        decisionReason: 'Not approved',
      },
    });
  });

  it('stores approval decision metadata on a successful approval', async () => {
    const authorizationService = {
      canApproveOrRejectRequest: jest.fn().mockResolvedValue(true),
    } as any;
    const prisma = {
      leave: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 15,
            employeeId: 7,
            leaveTypeId: 1,
            yearStart: 2026,
            totalDays: 2,
            status: 'PENDING',
            remarks: 'Approved for the reason',
            isLossOfPay: false,
          })
          .mockResolvedValueOnce({
            id: 15,
            employeeId: 7,
            leaveTypeId: 1,
            yearStart: 2026,
            totalDays: 2,
            status: 'APPROVED',
            remarks: 'Approved for the reason',
            isLossOfPay: false,
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 10 }) },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({ allocated: 10, carryForward: 0, used: 0 }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    } as any;
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));

    const service = new LeaveService(prisma, {} as any, authorizationService);
    await expect(service.approveLeave(15, 10, 'HR')).resolves.toEqual(expect.objectContaining({ status: 'APPROVED' }));
    expect(prisma.leave.updateMany).toHaveBeenCalledWith({
      where: { id: 15, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        decisionByEmployeeId: 10,
        decisionByRole: 'HR',
        decisionAt: expect.any(Date),
        decisionReason: 'Approved for the reason',
        paidLeaveDays: 2,
        lopDays: 0,
      },
    });
  });

  it('keeps pending Leave decision fields null before a decision is made', async () => {
    const pendingLeave = {
      id: 15,
      employeeId: 7,
      status: 'PENDING',
      decisionByEmployeeId: null,
      decisionByRole: null,
      decisionAt: null,
      decisionReason: null,
    };
    const prisma = {
      leave: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(pendingLeave)
          .mockResolvedValueOnce({ ...pendingLeave, status: 'REJECTED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 10 }) },
      $transaction: jest.fn(),
    } as any;
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));

    const service = new LeaveService(prisma, {} as any, { canApproveOrRejectRequest: jest.fn().mockResolvedValue(true) } as any);
    await expect(service.rejectLeave(15, 'Not approved', 10, 'HR')).resolves.toEqual(expect.objectContaining({ status: 'REJECTED' }));
    expect(prisma.leave.findUnique).toHaveBeenCalled();
    expect(pendingLeave.decisionByEmployeeId).toBeNull();
    expect(pendingLeave.decisionByRole).toBeNull();
    expect(pendingLeave.decisionAt).toBeNull();
    expect(pendingLeave.decisionReason).toBeNull();
  });
});

describe('LeaveService manager-scoped approval', () => {
  const leave = { id: 15, employeeId: 77, leaveTypeId: 5, yearStart: 2026, totalDays: 2, status: 'PENDING' };

  const createService = (
    role: string,
    canApproveOrReject = true,
    finalStatus: 'APPROVED' | 'REJECTED' = 'APPROVED',
    initialStatus: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING',
  ) => {
    const authorizationService = {
      canApproveOrRejectRequest: jest.fn().mockResolvedValue(canApproveOrReject),
    } as any;
    const prisma = {
      leave: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ ...leave, status: initialStatus })
          .mockResolvedValueOnce({ ...leave, status: finalStatus }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      employee: {
        findUnique: jest.fn().mockImplementation(async ({ select }: any) =>
          select?.team
            ? { id: 77, user: { role: 'EMPLOYEE' }, team: { name: role === 'IT_MANAGER' ? 'IT' : role === 'SALES_MANAGER' ? 'SALES' : role === 'FINANCE_MANAGER' ? 'FINANCE' : 'IT' } }
            : { id: 10 },
        ),
      },
      $transaction: jest.fn(),
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({ allocated: 10, carryForward: 0, used: 0 }),
        update: jest.fn(),
      },
    } as any;
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    return { service: new LeaveService(prisma, {} as any, authorizationService), authorizationService, prisma, role };
  };

  it.each([
    ['IT_MANAGER', 10],
    ['SALES_MANAGER', 10],
    ['FINANCE_MANAGER', 10],
    ['HR', 10],
    ['SUPER_ADMIN', 10],
  ])('valid %s approval is allowed', async (role, approverId) => {
    const { service } = createService(role, true);
    await expect(service.approveLeave(15, approverId, role)).resolves.toEqual(expect.objectContaining({ status: 'APPROVED' }));
  });

  it('CEO approval is allowed when hierarchy permits', async () => {
    const { service, authorizationService } = createService('CEO', true);
    await expect(service.approveLeave(15, 5, 'CEO')).resolves.toEqual(expect.objectContaining({ status: 'APPROVED' }));
    expect(authorizationService.canApproveOrRejectRequest).toHaveBeenCalledWith({ id: 5, role: 'CEO', employeeId: 5 }, 77);
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'])('wrong %s approval is rejected', async (role) => {
    const { service, authorizationService, prisma } = createService(role, false);
    await expect(service.approveLeave(15, 999, role)).rejects.toThrow('Unauthorized to approve leave');
    expect(authorizationService.canApproveOrRejectRequest).toHaveBeenCalledWith({ id: 999, role, employeeId: 999 }, 77);
    expect(prisma.leave.updateMany).not.toHaveBeenCalled();
  });

  it('manager self-approval is rejected', async () => {
    const { service, authorizationService, prisma } = createService('IT_MANAGER', false);
    await expect(service.approveLeave(15, 77, 'IT_MANAGER')).rejects.toThrow('Unauthorized to approve leave');
    expect(authorizationService.canApproveOrRejectRequest).toHaveBeenCalledWith({ id: 77, role: 'IT_MANAGER', employeeId: 77 }, 77);
    expect(prisma.leave.updateMany).not.toHaveBeenCalled();
  });

  it('employee self-approval is rejected', async () => {
    const { service, authorizationService, prisma } = createService('EMPLOYEE', false);
    await expect(service.approveLeave(15, 77, 'EMPLOYEE')).rejects.toThrow('Unauthorized to approve leave');
    expect(authorizationService.canApproveOrRejectRequest).toHaveBeenCalledWith({ id: 77, role: 'EMPLOYEE', employeeId: 77 }, 77);
    expect(prisma.leave.updateMany).not.toHaveBeenCalled();
  });

  it('finalized leave cannot receive a second decision', async () => {
    const { service, prisma } = createService('HR', true, 'APPROVED', 'APPROVED');
    await expect(service.approveLeave(15, 10, 'HR')).rejects.toThrow('Leave already processed');
    expect(prisma.leave.updateMany).not.toHaveBeenCalled();
  });

  it('uses the shared approval method for manager rejection', async () => {
    const { service, authorizationService, prisma } = createService('IT_MANAGER', true, 'REJECTED');
    await expect(service.rejectLeave(15, 'Not approved', 999, 'IT_MANAGER')).resolves.toEqual(expect.objectContaining({ status: 'REJECTED' }));
    expect(authorizationService.canApproveOrRejectRequest).toHaveBeenCalledWith({ id: 999, role: 'IT_MANAGER', employeeId: 999 }, 77);
    expect(prisma.leave.updateMany).toHaveBeenCalledWith({
      where: { id: 15, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        remarks: 'Not approved',
        decisionByEmployeeId: 999,
        decisionByRole: 'IT_MANAGER',
        decisionAt: expect.any(Date),
        decisionReason: 'Not approved',
      },
    });
  });

  it('filters manager history in the database before pagination', async () => {
    const prisma = { leave: { findMany: jest.fn().mockResolvedValue([{ id: 1, employeeId: 77 }]), count: jest.fn().mockResolvedValue(1) }, $transaction: jest.fn() } as any;
    prisma.$transaction.mockImplementation((queries: any[]) => Promise.all(queries));
    const service = new LeaveService(prisma, {} as any, { canAccessEmployee: jest.fn() } as any);
    await expect(service.leaveHistory('IT_MANAGER', 10, 1, 10, { id: 10, role: 'IT_MANAGER', employeeId: 10 })).resolves.toEqual({ data: [{ id: 1, employeeId: 77 }], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } });
    expect(prisma.leave.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employee: { team: { managerId: 10 } }, employeeId: { not: 10 } } }));
  });

  it.each(['pendingRequests', 'allLeaveRequests'])('filters %s in the database', async (methodName) => {
    const prisma = { leave: { findMany: jest.fn().mockResolvedValue([{ id: 1, employeeId: 77 }]) } } as any;
    const service = new LeaveService(prisma, {} as any);
    await expect((service as any)[methodName]('IT_MANAGER', { id: 10, role: 'IT_MANAGER', employeeId: 10 })).resolves.toEqual([{ id: 1, employeeId: 77 }]);
    expect(prisma.leave.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ employee: { team: { managerId: 10 } } }) }));
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
  const prisma = {
    $transaction: transaction,
    employee: { findUnique: jest.fn().mockResolvedValue({ userId: null }) },
  } as any;
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
  return {
    state,
    prisma: {
      $transaction: transaction,
      employee: { findUnique: jest.fn().mockResolvedValue({ userId: null }) },
    } as any,
  };
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
  const authorizationService = {
    canApproveOrRejectRequest: jest.fn().mockResolvedValue(true),
    canAccessEmployee: jest.fn().mockResolvedValue(true),
  } as any;

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
