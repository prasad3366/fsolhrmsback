import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LeaveService } from './leave.service';

const actor = (role: string, employeeId = 10) => ({
  id: employeeId,
  role,
  employeeId,
});

describe('Leave master authorization and status rules', () => {
  const canAccessEmployee = jest.fn();
  const canApproveOrRejectRequest = jest.fn();
  const authorization = { canAccessEmployee, canApproveOrRejectRequest } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    canAccessEmployee.mockResolvedValue(true);
  });

  const serviceForAuthorization = () => new LeaveService({} as any, {} as any, authorization);

  it.each([
    ['SALES_MANAGER', 'EMPLOYEE', 'SALES', true],
    ['IT_MANAGER', 'EMPLOYEE', 'IT', true],
    ['SALES_MANAGER', 'EMPLOYEE', 'IT', false],
    ['IT_MANAGER', 'EMPLOYEE', 'SALES', false],
    ['HR', 'EMPLOYEE', null, true],
    ['HR', 'HR', null, false],
    ['SALES_MANAGER', 'SALES_MANAGER', 'SALES', false],
    ['IT_MANAGER', 'IT_MANAGER', 'IT', false],
    ['FINANCE_MANAGER', 'EMPLOYEE', 'SALES', false],
    ['CEO', 'EMPLOYEE', 'SALES', false],
    ['EMPLOYEE', 'EMPLOYEE', 'SALES', false],
    ['SUPER_ADMIN', 'CEO', null, true],
  ])('%s target %s team %s => %s', async (role, targetRole, teamName, expected) => {
    const tx = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 77,
          user: { role: targetRole },
          team: teamName ? { name: teamName } : null,
        }),
      },
    };
    canApproveOrRejectRequest.mockResolvedValue(expected);

    await expect(
      (serviceForAuthorization() as any).canManageTargetLeave(tx, 77, 10, role),
    ).resolves.toBe(expected);
  });

  it('does not trust an actor-supplied target employee identity', async () => {
    const tx = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 77,
          user: { role: 'EMPLOYEE' },
          team: { name: 'SALES' },
        }),
      },
    };
    canAccessEmployee.mockResolvedValue(false);
    canApproveOrRejectRequest.mockResolvedValue(false);

    await expect(
      (serviceForAuthorization() as any).canManageTargetLeave(tx, 77, 999, 'SALES_MANAGER'),
    ).resolves.toBe(false);
    expect(canApproveOrRejectRequest).toHaveBeenCalledWith(
      actor('SALES_MANAGER', 999),
      77,
    );
  });

  it.each(['APPROVED', 'REJECTED', 'CANCELLED'])('cannot reject %s Leave', async (status) => {
    const tx = {
      leave: { findUnique: jest.fn().mockResolvedValue({ id: 1, employeeId: 77, status }) },
      employee: { findUnique: jest.fn() },
    };
    canApproveOrRejectRequest.mockResolvedValue(true);
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const service = new LeaveService(prisma as any, {} as any, authorization);

    await expect(service.rejectLeave(1, 'Not approved', 10, 'SUPER_ADMIN'))
      .rejects.toThrow(BadRequestException);
    expect(tx.employee.findUnique).not.toHaveBeenCalled();
  });

  it('cancels an owner PENDING Leave without consuming or restoring balance', async () => {
    const tx = {
      leave: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 1, employeeId: 10, status: 'PENDING' })
          .mockResolvedValueOnce({ id: 1, employeeId: 10, status: 'CANCELLED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      leaveBalance: { updateMany: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const service = new LeaveService(prisma as any, {} as any, authorization);

    await expect(service.cancelLeave(1, 10, 'EMPLOYEE')).resolves.toEqual(
      expect.objectContaining({ status: 'CANCELLED' }),
    );
    expect(tx.leaveBalance.updateMany).not.toHaveBeenCalled();
  });

  it('cancels an approved Leave transactionally and restores used balance', async () => {
    const tx = {
      leave: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 1,
            employeeId: 77,
            leaveTypeId: 5,
            yearStart: 2026,
            totalDays: 2,
            status: 'APPROVED',
            isLossOfPay: false,
          })
          .mockResolvedValueOnce({ id: 1, status: 'CANCELLED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      employee: { findUnique: jest.fn() },
      leaveBalance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const service = new LeaveService(prisma as any, {} as any, authorization);

    await expect(service.cancelLeave(1, 10, 'SUPER_ADMIN')).resolves.toEqual(
      expect.objectContaining({ status: 'CANCELLED' }),
    );
    expect(tx.leaveBalance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { used: { decrement: 2 } },
    }));
  });

  it('denies an employee cancelling another employee Leave', async () => {
    const tx = {
      leave: { findUnique: jest.fn().mockResolvedValue({ id: 1, employeeId: 77, status: 'PENDING' }) },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const service = new LeaveService(prisma as any, {} as any, authorization);

    await expect(service.cancelLeave(1, 10, 'EMPLOYEE')).rejects.toThrow(ForbiddenException);
  });
});
