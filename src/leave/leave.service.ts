import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { getFinancialYearStart } from './utils/financial-year.util';
import { HolidaysService } from '../holidays/holidays.service';
import {
  AuthorizationService,
  AuthorizationUser,
} from '../common/authorization/authorization.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { ActionType, NotificationEntityType, Prisma } from '@prisma/client';
import { LeaveDurationType } from '@prisma/client';
import { NotificationService } from '../modules/notifications/notification.service';

const MAX_LEAVE_TEXT_LENGTH = 500;

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private holidayService: HolidaysService,
    private readonly authorizationService: AuthorizationService = new AuthorizationService(
      prisma,
    ),
    private readonly workingDaysService: WorkingDaysService = new WorkingDaysService(
      prisma,
      holidayService,
    ),
    private readonly notificationService: NotificationService = new NotificationService(prisma),
  ) {}

  // ================= CALCULATE DAYS =================
  private async calculateDays(
    employeeId: number,
    start: Date,
    end: Date,
    duration: string,
  ): Promise<number> {
    const dates: Date[] = [];
    for (
      let date = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      date <= end;
      date.setDate(date.getDate() + 1)
    ) {
      dates.push(new Date(date));
    }

    const workingDates = await this.workingDaysService.getWorkingDates(employeeId, dates);

    if (duration === 'HALF_DAY_FIRST' || duration === 'HALF_DAY_SECOND') {
      if (workingDates.length !== 1 || dates.length !== 1) {
        throw new BadRequestException('Half-day leave must be on a working day');
      }
      return 0.5;
    }

    if (workingDates.length === 0) {
      throw new BadRequestException('Leave must include a working day');
    }

    return workingDates.length;
  }

  private parseLeaveDate(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year, month - 1, day);
    }

    return new Date(value);
  }

  private isSerializationConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2034'
    );
  }

  private async canManageTargetLeave(
    tx: any,
    leaveEmployeeId: number,
    actorEmployeeId: number,
    actorRole: string,
  ): Promise<boolean> {
    return this.authorizationService.canApproveOrRejectRequest(
      {
        id: actorEmployeeId,
        role: actorRole,
        employeeId: actorEmployeeId,
      },
      leaveEmployeeId,
    );
  }

  private async resolveLeaveApprovalPool(targetEmployeeId: number) {
    const targetEmployee = await this.prisma.employee.findUnique({
      where: { id: targetEmployeeId },
      include: { user: true },
    });

    if (!targetEmployee) {
      return [] as Array<{ id: number; userId: number; role: string }>;
    }

    const eligibleApprovers = await this.prisma.employee.findMany({
      include: { user: true },
      where: {
        user: {
          role: {
            in: ['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER', 'HR', 'SUPER_ADMIN', 'CEO'],
          },
        },
      },
    });

    const approvedApprovers: Array<{ id: number; userId: number; role: string }> = [];

    for (const approver of eligibleApprovers) {
      const actor = {
        id: approver.userId ?? approver.id,
        role: approver.user?.role ?? '',
        employeeId: approver.id,
      };

      const allowed = await this.authorizationService.canApproveOrRejectRequest(
        actor,
        targetEmployeeId,
      );

      if (allowed && approver.userId) {
        approvedApprovers.push({
          id: approver.id,
          userId: approver.userId,
          role: approver.user.role,
        });
      }
    }

    return approvedApprovers;
  }

  private async notifyLeaveApprovers(leaveId: number, targetEmployeeId: number) {
    const approvers = await this.resolveLeaveApprovalPool(targetEmployeeId);

    for (const approver of approvers) {
      try {
        await this.notificationService.createActionItem({
          recipientUserId: approver.userId,
          entityType: NotificationEntityType.LEAVE,
          entityId: leaveId,
          actionType: ActionType.REVIEW,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) {
          throw error;
        }
      }

      await this.notificationService.createNotification({
        recipientUserId: approver.userId,
        entityType: NotificationEntityType.LEAVE,
        entityId: leaveId,
        title: 'Leave request pending approval',
        message: `A leave request requires your review and decision.`,
      });
    }
  }

  private async notifyLeaveDecision(
    leaveId: number,
    requesterUserId: number,
    decision: 'APPROVED' | 'REJECTED',
    approverEmployeeId: number,
    approverRole: string,
  ) {
    await this.notificationService.resolveActionItemsForEntity({
      entityType: NotificationEntityType.LEAVE,
      entityId: leaveId,
    });

    const approverUser = await this.prisma.employee.findUnique({
      where: { id: approverEmployeeId },
      include: { user: true },
    });

    const actorUserId = approverUser?.userId ?? approverEmployeeId;
    const decisionText = decision === 'APPROVED' ? 'approved' : 'rejected';
    const decisionReason = decision === 'APPROVED' ? 'has been approved' : 'has been rejected';

    await this.notificationService.createNotification({
      recipientUserId: requesterUserId,
      entityType: NotificationEntityType.LEAVE,
      entityId: leaveId,
      actorUserId: actorUserId,
      title: `Leave request ${decisionText}`,
      message: `Your leave request was ${decisionReason} by ${approverRole}.`,
    });
  }

  // ================= APPLY LEAVE =================
  async applyLeave(employeeId: number, dto: CreateLeaveDto) {
    if (
      typeof dto?.reason !== 'string' ||
      dto.reason.trim().length === 0
    ) {
      throw new BadRequestException('Reason is required');
    }

    if (dto.reason.length > MAX_LEAVE_TEXT_LENGTH) {
      throw new BadRequestException('Reason is too long');
    }

    const start = this.parseLeaveDate(dto.startDate);
    const end = this.parseLeaveDate(dto.endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (start > end) throw new BadRequestException('Invalid date range');

    const duration =
      dto.durationType === undefined ? LeaveDurationType.FULL_DAY : dto.durationType;
    if (!Object.values(LeaveDurationType).includes(duration as LeaveDurationType)) {
      throw new BadRequestException('Invalid duration type');
    }
    const yearStart = getFinancialYearStart(start);

    let createdLeave: any;

    try {
      createdLeave = await this.prisma.$transaction(async (tx) => {
        const employee = await tx.employee.findUnique({
          where: { id: employeeId },
          include: { user: true },
        });

        if (!employee) throw new BadRequestException('Employee not found');

        const leaveType = await tx.leaveType.findUnique({
          where: { id: dto.leaveTypeId },
        });

        if (!leaveType) throw new BadRequestException('Invalid leave type');

        const leavePolicy = tx.leavePolicy
          ? await tx.leavePolicy.findFirst({
              where: { leaveTypeName: leaveType.name },
            })
          : null;

        const totalDays = await this.calculateDays(employeeId, start, end, duration);

        const overlap = await tx.leave.findFirst({
          where: {
            employeeId,
            status: { in: ['PENDING', 'APPROVED'] },
            startDate: { lte: end },
            endDate: { gte: start },
          },
        });

        if (overlap) {
          throw new BadRequestException('Leave already exists for selected dates');
        }

        let balance = await tx.leaveBalance.findUnique({
          where: {
            employeeId_leaveTypeId_yearStart: {
              employeeId,
              leaveTypeId: dto.leaveTypeId,
              yearStart,
            },
          },
        });

        if (!balance) {
          balance = await tx.leaveBalance.create({
            data: {
              employeeId,
              leaveTypeId: dto.leaveTypeId,
              allocated: leavePolicy?.annualAllocation ?? leaveType.yearlyQuota,
              yearStart,
            },
          });
        }

        const available = balance.allocated + balance.carryForward - balance.used;
        const allowsLossOfPay = leavePolicy?.isLossOfPay === true;
        const isLossOfPay = available < totalDays && allowsLossOfPay;
        if (available < totalDays && !isLossOfPay) {
          throw new BadRequestException('Insufficient leave balance');
        }

        const paidLeaveDays = Math.min(totalDays, Math.max(0, available));
        const lopDays = isLossOfPay ? Math.max(totalDays - paidLeaveDays, 0) : 0;

        const requiresMedical = leavePolicy?.requiresDocument ?? leaveType.requiresMedical;
        if (requiresMedical && totalDays > 2 && !dto.medicalCertificate) {
          throw new BadRequestException(
            'Medical certificate required for leave greater than 2 days',
          );
        }

        return tx.leave.create({
          data: {
            employeeId,
            leaveTypeId: dto.leaveTypeId,
            startDate: start,
            endDate: end,
            durationType: duration,
            totalDays,
            paidLeaveDays,
            lopDays,
            reason: dto.reason,
            yearStart,
            medicalCertificate: dto.medicalCertificate,
            medicalCertificateFileName: dto.medicalCertificateFileName,
            isEmergency: dto.isEmergency ?? false,
            isLossOfPay,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      const requester = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true },
      });

      if (requester?.userId) {
        await this.notifyLeaveApprovers(createdLeave.id, employeeId);
      }

      return createdLeave;
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException('Leave request conflicts with another request');
      }
      throw error;
    }
  }

  // ================= APPROVE LEAVE =================
  async approveLeave(
    leaveId: number,
    approverEmployeeId: number,
    approverRole: string,
  ) {
    try {
      const approvedLeave = await this.prisma.$transaction(async (tx) => {
        const leave = await tx.leave.findUnique({
          where: { id: leaveId },
          include: { leaveType: true },
        });

        if (!leave) throw new NotFoundException('Leave not found');
        if (leave.status !== 'PENDING') {
          throw new BadRequestException('Leave already processed');
        }

        const approver = await tx.employee.findUnique({ where: { id: approverEmployeeId } });
        if (!approver) throw new BadRequestException('Approver not found');

        if (!(await this.canManageTargetLeave(tx, leave.employeeId, approverEmployeeId, approverRole))) {
          throw new BadRequestException('Unauthorized to approve leave');
        }

        const balance = await tx.leaveBalance.findUnique({
          where: {
            employeeId_leaveTypeId_yearStart: {
              employeeId: leave.employeeId,
              leaveTypeId: leave.leaveTypeId,
              yearStart: leave.yearStart,
            },
          },
        });

        if (!balance) throw new NotFoundException('Leave balance not found');

        const available = balance.allocated + balance.carryForward - balance.used;
        const isLop = leave.isLossOfPay ?? false;
        if (available < leave.totalDays && !isLop) {
          throw new BadRequestException('Insufficient leave balance');
        }

        const paidLeaveDays = isLop
          ? Math.min(leave.totalDays, Math.max(0, available))
          : Number(leave.paidLeaveDays ?? leave.totalDays ?? 0);
        const lopDays = Math.max(leave.totalDays - paidLeaveDays, 0);

        const decisionAt = new Date();
        const transition = await tx.leave.updateMany({
          where: { id: leaveId, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            decisionByEmployeeId: approverEmployeeId,
            decisionByRole: approverRole,
            decisionAt,
            decisionReason: leave.remarks ?? null,
            paidLeaveDays,
            lopDays,
          },
        });

        if (transition.count !== 1) {
          throw new BadRequestException('Leave already processed');
        }

        await tx.leaveBalance.update({
          where: {
            employeeId_leaveTypeId_yearStart: {
              employeeId: leave.employeeId,
              leaveTypeId: leave.leaveTypeId,
              yearStart: leave.yearStart,
            },
          },
          data: { used: { increment: paidLeaveDays } },
        });

        return tx.leave.findUnique({
          where: { id: leaveId },
          include: { employee: true, leaveType: true },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      const requester = await this.prisma.employee.findUnique({
        where: { id: approvedLeave?.employeeId ?? 0 },
        select: { userId: true },
      });

      if (requester?.userId) {
        await this.notifyLeaveDecision(
          leaveId,
          requester.userId,
          'APPROVED',
          approverEmployeeId,
          approverRole,
        );
      }

      return approvedLeave;
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException('Approval conflicts with another request');
      }
      throw error;
    }
  }

  // ================= REJECT LEAVE =================
  async rejectLeave(
    id: number,
    remarks: string,
    approverEmployeeId: number,
    approverRole: string,
  ) {
    if (typeof remarks !== 'string' || remarks.trim().length === 0) {
      throw new BadRequestException('Rejection remarks are required');
    }

    if (remarks.length > MAX_LEAVE_TEXT_LENGTH) {
      throw new BadRequestException('Rejection remarks are too long');
    }

    let rejectedLeave: any;

    try {
      rejectedLeave = await this.prisma.$transaction(async (tx) => {
        const leave = await tx.leave.findUnique({ where: { id } });
        if (!leave) throw new NotFoundException('Leave not found');
        if (leave.status !== 'PENDING') throw new BadRequestException('Leave already processed');

        const approver = await tx.employee.findUnique({ where: { id: approverEmployeeId } });
        if (!approver) throw new BadRequestException('Approver not found');
        if (!(await this.canManageTargetLeave(tx, leave.employeeId, approverEmployeeId, approverRole))) {
          throw new BadRequestException('Unauthorized to reject leave');
        }

        const decisionAt = new Date();
        const transition = await tx.leave.updateMany({
          where: { id, status: 'PENDING' },
          data: {
            status: 'REJECTED',
            remarks,
            decisionByEmployeeId: approverEmployeeId,
            decisionByRole: approverRole,
            decisionAt,
            decisionReason: remarks,
          },
        });
        if (transition.count !== 1) throw new BadRequestException('Leave already processed');
        return tx.leave.findUnique({ where: { id }, include: { employee: true, leaveType: true } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      const requester = await this.prisma.employee.findUnique({
        where: { id: rejectedLeave?.employeeId ?? 0 },
        select: { userId: true },
      });

      if (requester?.userId) {
        await this.notifyLeaveDecision(
          id,
          requester.userId,
          'REJECTED',
          approverEmployeeId,
          approverRole,
        );
      }

      return rejectedLeave;
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException('Rejection conflicts with another request');
      }
      throw error;
    }
  }

  async cancelLeave(id: number, actorEmployeeId: number, actorRole: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const leave = await tx.leave.findUnique({ where: { id } });
        if (!leave) throw new NotFoundException('Leave not found');
        if (!['PENDING', 'APPROVED'].includes(leave.status)) {
          throw new BadRequestException('Leave cannot be cancelled');
        }

        const role = String(actorRole ?? '').toUpperCase();
        const isOwner = leave.employeeId === actorEmployeeId;
        const canCancel = leave.status === 'PENDING'
          ? isOwner
          : await this.canManageTargetLeave(tx, leave.employeeId, actorEmployeeId, role);
        if (!canCancel) throw new ForbiddenException('Unauthorized to cancel leave');

        const transition = await tx.leave.updateMany({
          where: { id, status: leave.status },
          data: { status: 'CANCELLED' },
        });
        if (transition.count !== 1) throw new BadRequestException('Leave already processed');

        if (leave.status === 'APPROVED') {
          const paidLeaveDays = Number(leave.paidLeaveDays ?? leave.totalDays ?? 0);
          if (paidLeaveDays <= 0) {
            return tx.leave.findUnique({ where: { id }, include: { employee: true, leaveType: true } });
          }
          const balance = await tx.leaveBalance.updateMany({
            where: {
              employeeId: leave.employeeId,
              leaveTypeId: leave.leaveTypeId,
              yearStart: leave.yearStart,
              used: { gte: paidLeaveDays },
            },
            data: { used: { decrement: paidLeaveDays } },
          });
          if (balance.count !== 1) throw new BadRequestException('Leave balance cannot be restored');
        }

        return tx.leave.findUnique({ where: { id }, include: { employee: true, leaveType: true } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException('Cancellation conflicts with another request');
      }
      throw error;
    }
  }

  // ================= BALANCE =================
  async getLeaveTypes() {
    const leaveTypes = await this.prisma.leaveType.findMany({ orderBy: { name: 'asc' } });
    const policies = await this.prisma.leavePolicy.findMany();
    const policiesByName = new Map(policies.map((policy) => [policy.leaveTypeName, policy]));
    return leaveTypes.map((type) => {
      const policy = policiesByName.get(type.name);
      return {
        id: type.id,
        name: type.name,
        yearlyQuota: policy?.annualAllocation ?? type.yearlyQuota,
        carryForward: type.carryForward,
        maxCarryLimit: policy?.carryForwardMax ?? type.maxCarryLimit,
        monthlyAccrual: type.monthlyAccrual,
        requiresMedical: policy?.requiresDocument ?? type.requiresMedical,
      };
    });
  }

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
      leaveTypeId: b.leaveTypeId,
      id: b.leaveTypeId,
      leaveType: b.leaveType.name,
      allocated: b.allocated,
      used: b.used,
      carryForward: b.carryForward,
      remaining: b.allocated + b.carryForward - b.used,
    }));
  }

  // ================= LEAVE HISTORY =================
  async leaveHistory(
    role: string,
    employeeId: number,
    page: number = 1,
    limit: number = 10,
    user?: AuthorizationUser,
  ) {
    const normalizedRole = String(role ?? '').toUpperCase();
    const where: any = {
      ...(normalizedRole === 'EMPLOYEE' && { employeeId }),
      ...(['HR', 'CEO'].includes(normalizedRole) && { employeeId: { not: employeeId } }),
    };

    if (
      user &&
      (normalizedRole === 'IT_MANAGER' ||
        normalizedRole === 'SALES_MANAGER' ||
        normalizedRole === 'FINANCE_MANAGER')
    ) {
      const managedTeamWhere = {
        employee: { team: { managerId: Number(user.employeeId) } },
        employeeId: { not: Number(user.employeeId) },
      };
      const [data, total] = await this.prisma.$transaction([
        this.prisma.leave.findMany({
          where: managedTeamWhere,
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
          skip: (page - 1) * limit,
          take: limit,
        }),
      this.prisma.leave.count({ where: managedTeamWhere }),
    ]);
      return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.leave.findMany({
        where,
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
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.leave.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ================= PENDING REQUESTS =================
  async pendingRequests(role: string, user?: AuthorizationUser) {
    const normalizedRole = String(role ?? '').toUpperCase();
    if (normalizedRole === 'EMPLOYEE') {
      throw new BadRequestException('Access denied');
    }

    const where: any = { status: 'PENDING' };
    if (normalizedRole === 'HR' || normalizedRole === 'CEO') {
      where.employeeId = { not: Number(user?.employeeId) };
    }
    if (['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'].includes(normalizedRole)) {
      where.employee = { team: { managerId: Number(user?.employeeId) } };
      where.employeeId = { not: Number(user?.employeeId) };
    }
    return this.prisma.leave.findMany({
      where,
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ================= ALL LEAVE REQUESTS =================
  async allLeaveRequests(role: string, user?: AuthorizationUser) {
    const normalizedRole = String(role ?? '').toUpperCase();
    if (normalizedRole === 'EMPLOYEE') {
      throw new BadRequestException('Access denied');
    }

    const where: any = {};
    if (normalizedRole === 'HR' || normalizedRole === 'CEO') {
      where.employeeId = { not: Number(user?.employeeId) };
    }
    if (['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'].includes(normalizedRole)) {
      where.employee = { team: { managerId: Number(user?.employeeId) } };
      where.employeeId = { not: Number(user?.employeeId) };
    }
    return this.prisma.leave.findMany({
      where,
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async filterManagerLeaves<T extends { employeeId: number }>(
    user: AuthorizationUser,
    leaves: T[],
  ) {
    const visibleLeaves: T[] = [];
    for (const leave of leaves) {
      if (await this.authorizationService.canAccessEmployee(user, leave.employeeId)) {
        visibleLeaves.push(leave);
      }
    }
    return visibleLeaves;
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

  async selfMonthlyLeave(employeeId: number, month: number, year: number) {
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 1) {
      throw new BadRequestException('Invalid month or year');
    }
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    return this.prisma.leave.findMany({
      where: {
        employeeId,
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      include: { employee: true, leaveType: true },
      orderBy: { startDate: 'asc' },
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
          allocated: this.prisma.leavePolicy
            ? (
                await this.prisma.leavePolicy.findFirst({
                  where: { leaveTypeName: type.name },
                  select: { annualAllocation: true },
                })
              )?.annualAllocation ?? type.yearlyQuota
            : type.yearlyQuota,
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
      leaveTypeId: b.leaveTypeId,
      id: b.leaveTypeId,
      leaveType: b.leaveType.name,
      allocated: b.allocated ?? 0,
      used: b.used ?? 0,
      carryForward: b.carryForward ?? 0,
      remaining:
        (b.allocated ?? 0) + (b.carryForward ?? 0) - (b.used ?? 0),
    }));
  }

  async getTargetEmployeeLeaveSummary(
    user: AuthorizationUser | undefined,
    employeeId: number,
  ) {
    if (!user) {
      throw new ForbiddenException('Access denied');
    }

    const normalizedRole = String(user.role ?? '').toUpperCase();
    if (normalizedRole === 'FINANCE_MANAGER') {
      throw new ForbiddenException('Access denied');
    }

    const hasAccess = await this.authorizationService.canAccessEmployee(
      user,
      employeeId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('Access denied');
    }

    const [balances, leaves, employee] = await Promise.all([
      this.prisma.leaveBalance.findMany({
        where: { employeeId },
        include: { leaveType: { select: { name: true } } },
      }),
      this.prisma.leave.findMany({
        where: { employeeId },
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          totalDays: true,
          durationType: true,
          leaveType: { select: { name: true } },
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, status: true },
      }),
    ]);

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const now = new Date();
    const currentLeave = leaves.find(
      (leave) =>
        leave.status === 'APPROVED' &&
        leave.startDate <= now &&
        leave.endDate >= now,
    );

    const balanceSummary = balances.map((balance) => ({
      leaveType: balance.leaveType?.name ?? 'Unknown',
      allocated: balance.allocated ?? 0,
      used: balance.used ?? 0,
      carryForward: balance.carryForward ?? 0,
      remaining:
        (balance.allocated ?? 0) + (balance.carryForward ?? 0) - (balance.used ?? 0),
    }));

    const leaveCounts = {
      total: leaves.length,
      pending: leaves.filter((leave) => leave.status === 'PENDING').length,
      approved: leaves.filter((leave) => leave.status === 'APPROVED').length,
      rejected: leaves.filter((leave) => leave.status === 'REJECTED').length,
    };

    const recentHistory = leaves.slice(0, 5).map((leave) => ({
      id: leave.id,
      status: leave.status,
      leaveType: leave.leaveType?.name ?? 'Unknown',
      startDate: leave.startDate,
      endDate: leave.endDate,
      totalDays: leave.totalDays,
      durationType: leave.durationType,
    }));

    return {
      employeeId,
      status: employee.status,
      currentLeaveStatus: currentLeave
        ? {
            status: 'ON_LEAVE',
            leaveType: currentLeave.leaveType?.name ?? 'Unknown',
            startDate: currentLeave.startDate,
            endDate: currentLeave.endDate,
            totalDays: currentLeave.totalDays,
          }
        : { status: 'NOT_ON_LEAVE' },
      balanceSummary,
      leaveCounts,
      recentHistory,
    };
  }

  // ================= CARRY FORWARD =================
  async requestCarryForward(
    employeeId: number,
    leaveTypeId: number,
    yearStart: number,
  ) {
    const today = new Date();
    const expectedYearStart = getFinancialYearStart(today);

    if (
      !Number.isInteger(employeeId) ||
      employeeId <= 0 ||
      !Number.isInteger(leaveTypeId) ||
      leaveTypeId <= 0 ||
      !Number.isInteger(yearStart) ||
      yearStart <= 0 ||
      yearStart !== expectedYearStart
    ) {
      throw new BadRequestException('Invalid carry forward target');
    }

    // Allow carry forward only after financial year end (April)
    if (today.getMonth() < 3) {
      throw new BadRequestException(
        'Carry forward request allowed only after financial year end',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
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

    if (!balance) {
      throw new NotFoundException('Leave balance not found');
    }

    if (!balance.leaveType?.carryForward) {
      throw new BadRequestException(
        'Carry forward not allowed for this leave type',
      );
    }

    const remaining = balance.allocated + balance.carryForward - balance.used;

    if (!Number.isFinite(remaining) || remaining <= 0) {
      throw new BadRequestException(
        'No positive leave balance available for carry forward',
      );
    }

    const leavePolicy = this.prisma.leavePolicy
      ? await this.prisma.leavePolicy.findFirst({
          where: { leaveTypeName: balance.leaveType.name },
          select: { carryForwardMax: true },
        })
      : null;
    const maxCarry = leavePolicy
      ? leavePolicy.carryForwardMax
      :
      balance.leaveType.maxCarryLimit !== null &&
      balance.leaveType.maxCarryLimit !== undefined
        ? balance.leaveType.maxCarryLimit
        : remaining;

    if (!Number.isFinite(maxCarry) || maxCarry < 0) {
      throw new BadRequestException('Invalid carry forward limit');
    }

    const carryAmount = Math.min(remaining, maxCarry);

    await this.prisma.leaveBalance.update({
      where: {
        employeeId_leaveTypeId_yearStart: {
          employeeId,
          leaveTypeId,
          yearStart,
        },
      },
      data: {
        carryForward: carryAmount,
      },
    });

    return { message: 'Carry forward requested successfully' };
  }
}
