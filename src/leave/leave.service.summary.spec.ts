import { ForbiddenException } from '@nestjs/common';
import { LeaveService } from './leave.service';

describe('LeaveService target summary', () => {
  const prisma = {
    leaveBalance: { findMany: jest.fn() },
    leave: { findMany: jest.fn() },
    employee: { findUnique: jest.fn() },
  } as any;

  const holidayService = {} as any;

  it('allows an employee to access only their own leave summary', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValue(true),
    } as any;
    const service = new LeaveService(prisma, holidayService, authorizationService);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const leaveStart = new Date(today);
    leaveStart.setDate(leaveStart.getDate() - 1);
    const leaveEnd = new Date(today);
    leaveEnd.setDate(leaveEnd.getDate() + 1);

    prisma.leaveBalance.findMany.mockResolvedValue([
      { allocated: 10, used: 2, carryForward: 1, leaveType: { name: 'Annual Leave' } },
    ]);
    prisma.leave.findMany.mockResolvedValue([
      {
        id: 1,
        status: 'APPROVED',
        startDate: leaveStart,
        endDate: leaveEnd,
        totalDays: 3,
        durationType: 'FULL_DAY',
        leaveType: { name: 'Annual Leave' },
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
    ]);
    prisma.employee.findUnique.mockResolvedValue({ id: 7, status: 'ACTIVE' });

    await expect(
      service.getTargetEmployeeLeaveSummary({ id: 1, role: 'EMPLOYEE', employeeId: 7 }, 7),
    ).resolves.toEqual(expect.objectContaining({
      employeeId: 7,
      status: 'ACTIVE',
      currentLeaveStatus: expect.objectContaining({ status: 'ON_LEAVE' }),
    }));

    expect(prisma.leaveBalance.findMany).toHaveBeenCalled();
    expect(prisma.leave.findMany).toHaveBeenCalled();
  });

  it('denies unauthorised leave summary access', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValue(false),
    } as any;
    const service = new LeaveService(prisma, holidayService, authorizationService);

    await expect(
      service.getTargetEmployeeLeaveSummary({ id: 1, role: 'EMPLOYEE', employeeId: 7 }, 8),
    ).rejects.toThrow(ForbiddenException);
  });

  it('permits IT_MANAGER for assigned-team leave summaries and denies outside-team access', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    } as any;
    const service = new LeaveService(prisma, holidayService, authorizationService);

    prisma.leaveBalance.findMany.mockResolvedValue([]);
    prisma.leave.findMany.mockResolvedValue([]);
    prisma.employee.findUnique.mockResolvedValue({ id: 9, status: 'ACTIVE' });

    await expect(
      service.getTargetEmployeeLeaveSummary({ id: 1, role: 'IT_MANAGER', employeeId: 10 }, 9),
    ).resolves.toEqual(expect.objectContaining({ employeeId: 9 }));

    await expect(
      service.getTargetEmployeeLeaveSummary({ id: 1, role: 'IT_MANAGER', employeeId: 10 }, 11),
    ).rejects.toThrow(ForbiddenException);
  });

  it('denies FINANCE_MANAGER leave access even when the employee check would otherwise pass', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValue(true),
    } as any;
    const service = new LeaveService(prisma, holidayService, authorizationService);

    await expect(
      service.getTargetEmployeeLeaveSummary({ id: 1, role: 'FINANCE_MANAGER', employeeId: 10 }, 7),
    ).rejects.toThrow(ForbiddenException);

    expect(authorizationService.canAccessEmployee).not.toHaveBeenCalled();
  });

  it('excludes sensitive leave fields from the summary payload', async () => {
    const authorizationService = {
      canAccessEmployee: jest.fn().mockResolvedValue(true),
    } as any;
    const service = new LeaveService(prisma, holidayService, authorizationService);

    prisma.leaveBalance.findMany.mockResolvedValue([]);
    prisma.leave.findMany.mockResolvedValue([
      {
        id: 1,
        status: 'PENDING',
        startDate: new Date('2026-09-10'),
        endDate: new Date('2026-09-12'),
        totalDays: 3,
        durationType: 'FULL_DAY',
        leaveType: { name: 'Sick Leave' },
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
    ]);
    prisma.employee.findUnique.mockResolvedValue({ id: 7, status: 'ACTIVE' });

    const result = await service.getTargetEmployeeLeaveSummary({ id: 1, role: 'EMPLOYEE', employeeId: 7 }, 7);

    expect(result).not.toHaveProperty('medicalCertificate');
    expect(result).not.toHaveProperty('reason');
    expect(result).not.toHaveProperty('remarks');
    expect(result.recentHistory[0]).not.toHaveProperty('medicalCertificate');
  });
});
