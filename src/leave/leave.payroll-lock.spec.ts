import { LeaveService } from './leave.service';

describe('LeaveService payroll lock / stale marking', () => {
  // 28 Sep belongs to the September payroll period, 29 Sep to October
  const leave = {
    id: 15,
    employeeId: 7,
    leaveTypeId: 1,
    yearStart: 2026,
    totalDays: 2,
    paidLeaveDays: 2,
    lopDays: 0,
    startDate: new Date('2026-09-28T00:00:00.000Z'),
    endDate: new Date('2026-09-29T00:00:00.000Z'),
    isLossOfPay: false,
    leaveType: { name: 'Earned Leave' },
  };

  const createService = (status: 'PENDING' | 'APPROVED', lockedPayroll: any = null) => {
    const prisma = {
      leave: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ ...leave, status })
          .mockResolvedValue({ ...leave, status: 'DONE' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 10 }) },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({ allocated: 10, carryForward: 0, used: 2 }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payroll: {
        findFirst: jest.fn().mockResolvedValue(lockedPayroll),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
    } as any;
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    const service = new LeaveService(
      prisma,
      {} as any,
      { canApproveOrRejectRequest: jest.fn().mockResolvedValue(true) } as any,
    );
    return { service, prisma };
  };

  const bothPeriods = [{ month: 9, year: 2026 }, { month: 10, year: 2026 }];

  it('approving a leave marks the DRAFT payroll of every affected period stale', async () => {
    const { service, prisma } = createService('PENDING');

    await service.approveLeave(15, 10, 'HR');

    expect(prisma.payroll.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 7, OR: bothPeriods, status: 'DRAFT' },
      data: { needsRecalculation: true },
    });
  });

  it('approving a leave is rejected when an affected payroll is finalized', async () => {
    const { service, prisma } = createService('PENDING', { id: 3, month: 10, year: 2026 });

    await expect(service.approveLeave(15, 10, 'HR')).rejects.toThrow('Payroll for 10/2026 is finalized');
    expect(prisma.payroll.findFirst).toHaveBeenCalledWith({
      where: { employeeId: 7, OR: bothPeriods, status: { in: ['FINALIZED', 'PAID'] } },
      select: { id: true, month: true, year: true },
    });
    expect(prisma.leave.updateMany).not.toHaveBeenCalled();
  });

  it('cancelling an APPROVED leave marks payroll stale', async () => {
    const { service, prisma } = createService('APPROVED');

    await service.cancelLeave(15, 10, 'HR');

    expect(prisma.payroll.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 7, OR: bothPeriods, status: 'DRAFT' },
      data: { needsRecalculation: true },
    });
  });

  it('cancelling an APPROVED leave is rejected for a finalized payroll period', async () => {
    const { service, prisma } = createService('APPROVED', { id: 3, month: 9, year: 2026 });

    await expect(service.cancelLeave(15, 10, 'HR')).rejects.toThrow('Payroll for 9/2026 is finalized');
    expect(prisma.leave.updateMany).not.toHaveBeenCalled();
  });

  it('rejecting a PENDING leave does not touch payroll, even for a finalized period', async () => {
    const { service, prisma } = createService('PENDING', { id: 3, month: 9, year: 2026 });

    await service.rejectLeave(15, 'Not approved', 10, 'HR');

    expect(prisma.payroll.findFirst).not.toHaveBeenCalled();
    expect(prisma.payroll.updateMany).not.toHaveBeenCalled();
  });

  it('cancelling a PENDING leave does not touch payroll', async () => {
    const { service, prisma } = createService('PENDING', { id: 3, month: 9, year: 2026 });

    await service.cancelLeave(15, 7, 'EMPLOYEE');

    expect(prisma.payroll.findFirst).not.toHaveBeenCalled();
    expect(prisma.payroll.updateMany).not.toHaveBeenCalled();
  });
});
