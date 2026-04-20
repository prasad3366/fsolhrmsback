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

  // ================= CALCULATE DAYS =================
  private calculateDays(start: Date, end: Date, duration: string): number {
    if (duration === 'HALF_DAY') return 0.5;

    const diff = end.getTime() - start.getTime();
    return Math.floor(diff / 86400000) + 1;
  }

  // ================= APPLY LEAVE =================
  async applyLeave(employeeId: number, dto: CreateLeaveDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: true },
    });

    if (!employee) throw new BadRequestException('Employee not found');

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

    // ⭐ Prevent overlapping leaves
    const overlap = await this.prisma.leave.findFirst({
      where: {
        employeeId,
        status: { not: 'REJECTED' },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });

    if (overlap) {
      throw new BadRequestException(
        'Leave already exists for selected dates',
      );
    }

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

    if (available < totalDays) {
      throw new BadRequestException('Insufficient leave balance');
    }

    // ⭐ Medical certificate rule
    if (leaveType.requiresMedical && totalDays > 2 && !dto.medicalCertificate) {
      throw new BadRequestException(
        'Medical certificate required for leave greater than 2 days',
      );
    }

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
        medicalCertificate: dto.medicalCertificate,
        isEmergency: dto.isEmergency ?? false,
      },
    });
  }

  // ================= APPROVE LEAVE =================
  async approveLeave(
    leaveId: number,
    approverEmployeeId: number,
    approverRole: string,
  ) {
    const leave = await this.prisma.leave.findUnique({
      where: { id: leaveId },
      include: { employee: { include: { user: true } } },
    });

    if (!leave) throw new NotFoundException('Leave not found');

    if (leave.status !== 'PENDING')
      throw new BadRequestException('Leave already processed');

    const approver = await this.prisma.employee.findUnique({
      where: { id: approverEmployeeId },
      include: { user: true },
    });

    if (!approver) throw new BadRequestException('Approver not found');

    const isReportingManager =
      leave.employee.reportingManager === approver.user.email;

    const canApprove =
      isReportingManager || approverRole === 'HR' || approverRole === 'ADMIN';

    if (!canApprove)
      throw new BadRequestException('Unauthorized to approve leave');

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
        data: {
          used: { increment: leave.totalDays },
        },
      }),
    ]);

    return this.prisma.leave.findUnique({
      where: { id: leaveId },
      include: { employee: true, leaveType: true },
    });
  }

  // ================= REJECT LEAVE =================
  async rejectLeave(
    id: number,
    remarks: string,
    approverEmployeeId: number,
    approverRole: string,
  ) {
    const leave = await this.prisma.leave.findUnique({
      where: { id },
      include: { employee: { include: { user: true } } },
    });

    if (!leave) throw new NotFoundException('Leave not found');

    const approver = await this.prisma.employee.findUnique({
      where: { id: approverEmployeeId },
      include: { user: true },
    });

    if (!approver) throw new BadRequestException('Approver not found');

    const isReportingManager =
      leave.employee.reportingManager === approver.user.email;

    const canApprove =
      isReportingManager || approverRole === 'HR' || approverRole === 'ADMIN';

    if (!canApprove)
      throw new BadRequestException('Unauthorized to reject leave');

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
      carryForward: b.carryForward,
      remaining: b.allocated + b.carryForward - b.used,
    }));
  }

  // ================= LEAVE HISTORY =================
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
    if (role === 'EMPLOYEE') {
      throw new BadRequestException('Access denied');
    }

    return this.prisma.leave.findMany({
      where: { status: 'PENDING' },
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ================= ALL LEAVE REQUESTS =================
  async allLeaveRequests(role: string) {
    if (role === 'EMPLOYEE') {
      throw new BadRequestException('Access denied');
    }

    return this.prisma.leave.findMany({
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ================= SELF LEAVE HISTORY =================
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

  // ================= SELF BALANCE =================
  async selfBalance(employeeId: number, yearStart: number) {
    const leaveTypes = await this.prisma.leaveType.findMany();

    // Ensure balance exists for all leave types
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

    // Fetch balances
    const balances = await this.prisma.leaveBalance.findMany({
      where: { employeeId, yearStart },
      include: { leaveType: true },
    });

    return balances.map((b) => ({
      leaveType: b.leaveType.name,
      allocated: b.allocated ?? 0,
      used: b.used ?? 0,
      carryForward: b.carryForward ?? 0,
      remaining:
        (b.allocated ?? 0) + (b.carryForward ?? 0) - (b.used ?? 0),
    }));
  }

  // ================= CARRY FORWARD =================
  async requestCarryForward(
    employeeId: number,
    leaveTypeId: number,
    yearStart: number,
  ) {
    const today = new Date();

    // Allow carry forward only after financial year end (April)
    if (today.getMonth() < 3) {
      throw new BadRequestException(
        'Carry forward request allowed only after financial year end',
      );
    }

    const balance = await this.prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_yearStart: {
          employeeId,
          leaveTypeId,
          yearStart,
        },
      },
      include: { leaveType: true },
    });

    if (!balance || !balance.leaveType.carryForward) {
      throw new BadRequestException(
        'Carry forward not allowed for this leave type',
      );
    }

    const remaining = balance.allocated + balance.carryForward - balance.used;
    const maxCarry = balance.leaveType.maxCarryLimit ?? remaining;

    await this.prisma.leaveBalance.update({
      where: {
        employeeId_leaveTypeId_yearStart: {
          employeeId,
          leaveTypeId,
          yearStart,
        },
      },
      data: {
        carryForward: Math.min(remaining, maxCarry),
      },
    });

    return { message: 'Carry forward requested successfully' };
  }
}
