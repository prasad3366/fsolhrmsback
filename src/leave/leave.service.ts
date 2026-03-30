import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { getFinancialYearStart } from './utils/financial-year.util';
import { HolidaysService } from '../holidays/holidays.service';

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private holidayService: HolidaysService,
  ) {}

  private calculateDays(start: Date, end: Date, duration: string): number {
    if (duration !== 'FULL_DAY') return 0.5;
    return (end.getTime() - start.getTime()) / 86400000 + 1;
  }

  // ================= APPLY LEAVE =================
  async applyLeave(employeeId: number, dto: CreateLeaveDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: true },
    });

    const leaveType = await this.prisma.leaveType.findUnique({
      where: { id: dto.leaveTypeId },
    });

    if (!leaveType) throw new BadRequestException('Invalid leave type');

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (start > end) throw new BadRequestException('Invalid date range');

    const duration = dto.durationType ?? 'FULL_DAY';
    const totalDays = this.calculateDays(start, end, duration);
    const yearStart = getFinancialYearStart(start);

    let balance = await this.prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_yearStart: {
          employeeId,
          leaveTypeId: dto.leaveTypeId,
          yearStart,
        },
      },
    });

    if (!balance) {
      balance = await this.prisma.leaveBalance.create({
        data: {
          employeeId,
          leaveTypeId: dto.leaveTypeId,
          allocated: leaveType.yearlyQuota,
          yearStart,
        },
      });
    }

    const available = balance.allocated + balance.carryForward - balance.used;

    if (available < totalDays)
      throw new BadRequestException('Insufficient balance');

    return this.prisma.leave.create({
      data: {
        employeeId,
        leaveTypeId: dto.leaveTypeId,
        startDate: start,
        endDate: end,
        durationType: duration,
        totalDays,
        reason: dto.reason,
        yearStart,
      },
    });
  }

  // ================= APPROVE LEAVE =================
  async approveLeave(leaveId: number, approverRole: string) {
    const leave = await this.prisma.leave.findUnique({
      where: { id: leaveId },
      include: { employee: { include: { user: true } } },
    });

    if (!leave) throw new NotFoundException('Leave not found');

    if (leave.status !== 'PENDING')
      throw new BadRequestException('Already processed');

    const applicantRole = leave.employee.user.role;

    // ⭐ Approval Hierarchy
    if (
      (applicantRole === 'HR' || applicantRole === 'MANAGER') &&
      approverRole !== 'ADMIN'
    ) {
      throw new BadRequestException('Only Admin can approve this leave');
    }

    if (applicantRole === 'EMPLOYEE' && approverRole === 'EMPLOYEE') {
      throw new BadRequestException('Employee cannot approve leave');
    }

    await this.prisma.$transaction([
      this.prisma.leave.update({
        where: { id: leaveId },
        data: { status: 'APPROVED' },
      }),

      this.prisma.leaveBalance.update({
        where: {
          employeeId_leaveTypeId_yearStart: {
            employeeId: leave.employeeId,
            leaveTypeId: leave.leaveTypeId,
            yearStart: leave.yearStart,
          },
        },
        data: { used: { increment: leave.totalDays } },
      }),
    ]);

    return this.prisma.leave.findUnique({
      where: { id: leaveId },
      include: { employee: true, leaveType: true },
    });
  }

  // ================= REJECT LEAVE =================
  async rejectLeave(id: number, remarks: string, approverRole: string) {
    const leave = await this.prisma.leave.findUnique({
      where: { id },
      include: { employee: { include: { user: true } } },
    });

    if (!leave) throw new NotFoundException('Leave not found');

    const applicantRole = leave.employee.user.role;

    if (
      (applicantRole === 'HR' || applicantRole === 'MANAGER') &&
      approverRole !== 'ADMIN'
    ) {
      throw new BadRequestException('Only Admin can reject this leave');
    }

    await this.prisma.leave.update({
      where: { id },
      data: { status: 'REJECTED', remarks },
    });

    return this.prisma.leave.findUnique({
      where: { id },
      include: { employee: true, leaveType: true },
    });
  }

  // ================= BALANCE =================
  async getBalance(role: string, employeeId: number, yearStart: number) {
    const employees =
      role === 'EMPLOYEE'
        ? [{ id: employeeId }]
        : await this.prisma.employee.findMany({ select: { id: true } });

    const balances = await this.prisma.leaveBalance.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        yearStart,
      },
      include: { employee: true, leaveType: true },
    });

    return balances.map((b) => ({
      employeeId: b.employeeId,
      employeeName: `${b.employee.firstName} ${b.employee.lastName}`,
      leaveType: b.leaveType.name,
      allocated: b.allocated,
      used: b.used,
      remaining: b.allocated + b.carryForward - b.used,
    }));
  }

  // ================= EMPLOYEE HISTORY + STATUS =================
  async leaveHistory(role: string, employeeId: number) {
    return this.prisma.leave.findMany({
      where: {
        ...(role === 'EMPLOYEE' && { employeeId }),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            empCode: true,
            user: { select: { email: true } },
          },
        },
        leaveType: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ================= PENDING REQUESTS =================
  async pendingRequests(role: string) {
    if (role === 'EMPLOYEE') throw new BadRequestException('Access denied');

    return this.prisma.leave.findMany({
      where: { status: 'PENDING' },
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ================= ALL LEAVE REQUESTS =================
  async allLeaveRequests(role: string) {
    if (role === 'EMPLOYEE') throw new BadRequestException('Access denied');

    return this.prisma.leave.findMany({
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async selfLeaveHistory(employeeId: number) {
    return this.prisma.leave.findMany({
      where: { employeeId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            empCode: true,
            user: { select: { email: true } },
          },
        },
        leaveType: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async selfBalance(employeeId: number, yearStart: number) {
    const leaveTypes = await this.prisma.leaveType.findMany();

    // ⭐ Ensure balance exists
    for (const type of leaveTypes) {
      await this.prisma.leaveBalance.upsert({
        where: {
          employeeId_leaveTypeId_yearStart: {
            employeeId,
            leaveTypeId: type.id,
            yearStart,
          },
        },
        update: {},
        create: {
          employeeId,
          leaveTypeId: type.id,
          allocated: type.yearlyQuota,
          used: 0,
          carryForward: 0,
          yearStart,
        },
      });
    }

    // ⭐ Fetch balances
    const balances = await this.prisma.leaveBalance.findMany({
      where: { employeeId, yearStart },
      include: { leaveType: true },
    });

    return balances.map((b) => ({
      leaveType: b.leaveType.name,
      allocated: b.allocated ?? 0,
      used: b.used ?? 0,
      carryForward: b.carryForward ?? 0,
      remaining: (b.allocated ?? 0) + (b.carryForward ?? 0) - (b.used ?? 0),
    }));
  }

  async monthlyLeaves(employeeId: number, month: number, year: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);

    return this.prisma.leave.findMany({
      where: {
        employeeId,
        startDate: { gte: start, lte: end },
      },
      include: { leaveType: true },
      orderBy: { startDate: 'desc' },
    });
  }

  private async countWorkingDays(start: Date, end: Date) {
    let total = 0;
    const current = new Date(start);

    while (current <= end) {
      const isHoliday = await this.holidayService.isHoliday(current);

      const day = current.getDay();
      const isWeekend = day === 0 || day === 6;

      if (!isHoliday && !isWeekend) {
        total++;
      }

      current.setDate(current.getDate() + 1);
    }

    return total;
  }
}
