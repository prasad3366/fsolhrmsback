import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  AttendanceStatus,
  EmployeeStatus,
  EnrollmentStatus,
  JobStatus,
  TrainingStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AuthorizationService,
  AuthorizationUser,
} from '../../common/authorization/authorization.service';
import { WorkingDaysService } from '../../common/working-days/working-days.service';
import { MonthlyAttendanceReportQueryDto } from './dto/monthly-attendance-report-query.dto';

interface DateRange {
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly workingDaysService: WorkingDaysService,
  ) {}

  private async getReportScope(user: AuthorizationUser | undefined) {
    const role = String(user?.role ?? '').toUpperCase();
    if (!user || !['SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER'].includes(role)) {
      throw new ForbiddenException('Reports access denied');
    }

    if (this.authorizationService.canAccessOrganizationWide(user, 'employee')) {
      return {
        employeeWhere: undefined,
        attendanceEmployeeWhere: undefined,
        jobWhere: undefined,
        trainingWhere: undefined,
        enrollmentWhere: undefined,
      };
    }

    if (!['IT_MANAGER', 'SALES_MANAGER'].includes(role)) {
      throw new ForbiddenException('Reports access denied');
    }

    const managerEmployeeId = Number(user.employeeId);
    if (!Number.isInteger(managerEmployeeId) || managerEmployeeId <= 0) {
      throw new ForbiddenException('Reports access denied');
    }

    const managedTeams = await this.prisma.team.findMany({
      where: { managerId: managerEmployeeId },
      select: { id: true },
    });
    const teamIds = managedTeams.map((team) => team.id);
    if (!teamIds.length) {
      return {
        employeeWhere: { id: { in: [] } },
        attendanceEmployeeWhere: { id: { in: [] } },
        jobWhere: { teamId: { in: [] } },
        trainingWhere: { department: { in: [] } },
        enrollmentWhere: { employee: { teamId: { in: [] } } },
      };
    }

    const canAccessTeams = await Promise.all(
      teamIds.map((teamId) => this.authorizationService.canAccessTeam(user, teamId)),
    );
    if (canAccessTeams.some((allowed) => !allowed)) {
      throw new ForbiddenException('Reports access denied');
    }

    const teamEmployees = await this.prisma.employee.findMany({
      where: { teamId: { in: teamIds } },
      select: { department: true },
    });
    const departments = [...new Set(teamEmployees.map((employee) => employee.department).filter(Boolean))];

    return {
      employeeWhere: { teamId: { in: teamIds } },
      attendanceEmployeeWhere: { teamId: { in: teamIds } },
      jobWhere: { teamId: { in: teamIds } },
      trainingWhere: { department: { in: departments } },
      enrollmentWhere: { employee: { teamId: { in: teamIds } } },
    };
  }

  async getExecutiveSummary(user: AuthorizationUser) {
    const scope = await this.getReportScope(user);
    const { start, end } = this.getTodayRange();

    const [
      totalEmployees,
      activeEmployees,
      todayPresent,
      openJobs,
      activeTraining,
      totalEnrollments,
      completedEnrollments,
      employees,
    ] = await Promise.all([
      this.prisma.employee.count({ where: scope.employeeWhere }),
      this.prisma.employee.count({ where: { ...scope.employeeWhere, status: EmployeeStatus.ACTIVE } }),
      this.prisma.attendanceRecord.count({
        where: {
          date: { gte: start, lte: end },
          status: { in: [AttendanceStatus.PRESENT, 'LATE'] },
          user: { employee: scope.attendanceEmployeeWhere },
        },
      }),
      this.prisma.jobPosting.count({ where: { ...scope.jobWhere, status: JobStatus.OPEN } }),
      this.prisma.trainingProgram.count({
        where: {
          ...scope.trainingWhere,
          status: { in: [TrainingStatus.IN_PROGRESS, TrainingStatus.UPCOMING] },
        },
      }),
      this.prisma.trainingEnrollment.count({ where: scope.enrollmentWhere }),
      this.prisma.trainingEnrollment.count({
        where: { ...scope.enrollmentWhere, status: EnrollmentStatus.COMPLETED },
      }),
      this.prisma.employee.findMany({
        where: scope.employeeWhere,
        select: { department: true },
        orderBy: { department: 'asc' },
      }),
    ]);

    const departmentCounts = new Map<string, number>();
    for (const employee of employees) {
      departmentCounts.set(
        employee.department,
        (departmentCounts.get(employee.department) ?? 0) + 1,
      );
    }
    const uniqueDepartments = new Set(
      employees
        .map(({ department }) => department)
        .filter((department): department is string =>
          Boolean(department && department.trim() !== ''),
        ),
    );
    const activeDepartmentsCount = uniqueDepartments.size;

    return {
      totalEmployees,
      activeEmployees,
      todayAttendancePercentage: totalEmployees
        ? Math.round((todayPresent / totalEmployees) * 100)
        : 0,
      trainingCompletionRate: totalEnrollments
        ? Math.round((completedEnrollments / totalEnrollments) * 100)
        : 0,
      activeDepartments: activeDepartmentsCount,
      activeJobPostings: openJobs,
      activeTrainingPrograms: activeTraining,
      departmentDistribution: [...departmentCounts.entries()].map(
        ([department, count]) => ({ department, count }),
      ),
    };
  }

  async getEmployeeReportData(user: AuthorizationUser) {
    const scope = await this.getReportScope(user);
    return this.prisma.employee.findMany({
      where: { ...scope.employeeWhere, status: EmployeeStatus.ACTIVE },
      select: {
        id: true,
        empCode: true,
        firstName: true,
        lastName: true,
        department: true,
        designation: true,
        dateOfJoining: true,
        employmentType: true,
      },
      orderBy: [{ department: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async getAttendanceReportData(startDate?: string, endDate?: string, user?: AuthorizationUser) {
    const scope = await this.getReportScope(user);
    const range = this.parseDateRange(startDate, endDate);
    const attendance = await this.prisma.attendanceRecord.findMany({
      where: {
        date: {
          ...(range.startDate && { gte: range.startDate }),
          ...(range.endDate && { lte: range.endDate }),
        },
        user: { employee: { ...scope.attendanceEmployeeWhere, status: EmployeeStatus.ACTIVE } },
      },
      select: {
        date: true,
        status: true,
        clockIn: true,
        clockOut: true,
        user: {
          select: {
            employee: {
              select: {
                id: true,
                empCode: true,
                firstName: true,
                lastName: true,
                department: true,
              },
            },
          },
        },
      },
      orderBy: [{ userId: 'asc' }, { date: 'asc' }],
    });

    const rows = new Map<number, {
      employeeId: number;
      empCode: string;
      employeeName: string;
      department: string;
      totalPresentDays: number;
      totalAbsentDays: number;
      lateArrivals: number;
    }>();

    for (const record of attendance) {
      const employee = record.user.employee;
      if (!employee) continue;
      const row = rows.get(employee.id) ?? {
        employeeId: employee.id,
        empCode: employee.empCode,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        department: employee.department,
        totalPresentDays: 0,
        totalAbsentDays: 0,
        lateArrivals: 0,
      };

      const completedHours = this.getCompletedHours(record);
      const contribution = this.getAttendanceContribution(record, completedHours);
      if (contribution === 1) {
        row.totalPresentDays += 1;
      } else if (record.status === AttendanceStatus.ABSENT && record.clockIn && record.clockOut) {
        row.totalAbsentDays += 1;
      }
      if (record.clockIn && record.clockOut && (record.status === 'LATE' || this.isLateArrival(record.clockIn))) {
        row.lateArrivals += 1;
      }
      rows.set(employee.id, row);
    }

    return [...rows.values()];
  }

  async getTrainingReportData(user: AuthorizationUser) {
    const scope = await this.getReportScope(user);
    const programs = await this.prisma.trainingProgram.findMany({
      where: scope.trainingWhere,
      include: {
        _count: { select: { enrollments: true } },
        enrollments: {
          select: { status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return programs.map((program) => {
      const totalEnrollments = program._count.enrollments;
      const completedEnrollments = program.enrollments.filter(
        (enrollment) => enrollment.status === 'COMPLETED',
      ).length;

      return {
        id: program.id,
        title: program.title,
        department: program.department,
        trainer: program.trainer,
        status: program.status,
        startDate: program.startDate,
        endDate: program.endDate,
        totalEnrollments,
        completedEnrollments,
        completionRate: totalEnrollments
          ? this.roundPercentage((completedEnrollments / totalEnrollments) * 100)
          : 0,
      };
    });
  }

  async getMonthlyAttendanceReport(
    user: AuthorizationUser,
    query: MonthlyAttendanceReportQueryDto,
  ) {
    const scope = await this.getReportScope(user);
    const [yearText, monthText] = query.month.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const monthStart = new Date(year, month - 1, 1);
    const nextMonthStart = new Date(year, month, 1);
    const now = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const isFutureMonth = monthStart > new Date(now.getFullYear(), now.getMonth(), 1);
    const calculationEnd = isFutureMonth
      ? monthStart
      : isCurrentMonth
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      : nextMonthStart;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const employeePredicates: Record<string, unknown>[] = [
      ...(scope.employeeWhere ? [scope.employeeWhere] : []),
      { status: EmployeeStatus.ACTIVE },
    ];
    if (query.department?.trim()) employeePredicates.push({ department: query.department.trim() });
    if (query.teamId !== undefined) employeePredicates.push({ teamId: query.teamId });
    if (query.employeeId !== undefined) employeePredicates.push({ id: query.employeeId });
    const employeeWhere = { AND: employeePredicates };

    const employeeSelect = {
      id: true,
      userId: true,
      empCode: true,
      firstName: true,
      lastName: true,
      department: true,
      team: { select: { id: true, name: true } },
    };
    const totalEmployeeCount = await this.prisma.employee.count({ where: employeeWhere });
    const summaryEmployees = await this.prisma.employee.findMany({
      where: employeeWhere,
      select: { id: true, userId: true, empCode: true, team: { select: { id: true, name: true } } },
      orderBy: [{ empCode: 'asc' }, { id: 'asc' }],
    });
    const pageEmployees = await this.prisma.employee.findMany({
      where: employeeWhere,
      select: employeeSelect,
      orderBy: [{ empCode: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const employeeIds = summaryEmployees.map((employee) => employee.id);
    const userIds = summaryEmployees.map((employee) => employee.userId);

    const [attendanceRecords, approvedLeaves] = await Promise.all([
      userIds.length
        ? this.prisma.attendanceRecord.findMany({
            where: {
              userId: { in: userIds },
              date: { gte: monthStart, lt: calculationEnd },
            },
            select: { userId: true, date: true, status: true, clockIn: true, clockOut: true, totalHours: true },
          })
        : Promise.resolve([]),
      employeeIds.length
        ? this.prisma.leave.findMany({
            where: {
              employeeId: { in: employeeIds },
              status: 'APPROVED',
              startDate: { lt: calculationEnd },
              endDate: { gte: monthStart },
            },
            select: {
              employeeId: true,
              startDate: true,
              endDate: true,
              durationType: true,
              totalDays: true,
              status: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const dateKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const calendarDates: Date[] = [];
    for (let date = new Date(monthStart); date < calculationEnd; date.setDate(date.getDate() + 1)) {
      calendarDates.push(new Date(date));
    }

    const scheduleRepresentatives = new Map<string, number>();
    for (const employee of summaryEmployees) {
      const schedule = employee.team?.name?.toUpperCase() === 'SALES' ? 'SALES' : 'NORMAL';
      if (!scheduleRepresentatives.has(schedule)) scheduleRepresentatives.set(schedule, employee.id);
    }
    const workingDatesBySchedule = new Map<string, Set<string>>();
    for (const [schedule, representativeId] of scheduleRepresentatives) {
      const workingDates = await this.workingDaysService.getWorkingDates(representativeId, calendarDates);
      workingDatesBySchedule.set(schedule, new Set(workingDates.map(dateKey)));
    }

    const recordsByUser = new Map<number, any[]>();
    for (const record of attendanceRecords) {
      const records = recordsByUser.get(record.userId) ?? [];
      records.push(record);
      recordsByUser.set(record.userId, records);
    }
    const leavesByEmployee = new Map<number, any[]>();
    for (const leave of approvedLeaves) {
      const leaves = leavesByEmployee.get(leave.employeeId) ?? [];
      leaves.push(leave);
      leavesByEmployee.set(leave.employeeId, leaves);
    }

    const pageEmployeeDetails = new Map(pageEmployees.map((employee) => [employee.id, employee]));
    const rows = summaryEmployees.map((employee) => {
      const details = pageEmployeeDetails.get(employee.id);
      const schedule = employee.team?.name?.toUpperCase() === 'SALES' ? 'SALES' : 'NORMAL';
      const workingDateKeys = workingDatesBySchedule.get(schedule) ?? new Set<string>();
      const employeeLeaves = leavesByEmployee.get(employee.id) ?? [];
      const leaveDateKeys = new Set<string>();
      let approvedLeaveDays = 0;

      for (const leave of employeeLeaves) {
        if (leave?.status && leave.status !== 'APPROVED') continue;
        const overlapStart = leave.startDate > monthStart ? leave.startDate : monthStart;
        const overlapEnd = leave.endDate < new Date(calculationEnd.getTime() - 1) ? leave.endDate : new Date(calculationEnd.getTime() - 1);
        if (overlapStart > overlapEnd) continue;
        const leaveDates: Date[] = [];
        for (let date = new Date(overlapStart.getFullYear(), overlapStart.getMonth(), overlapStart.getDate()); date <= overlapEnd; date.setDate(date.getDate() + 1)) {
          leaveDates.push(new Date(date));
        }
        const workingLeaveDays = leaveDates.filter((date) => workingDateKeys.has(dateKey(date)));
        workingLeaveDays.forEach((date) => leaveDateKeys.add(dateKey(date)));
        const leaveSpanDays = Math.floor((leave.endDate.getTime() - leave.startDate.getTime()) / 86400000) + 1;
        approvedLeaveDays += leave.durationType === 'FULL_DAY'
          ? workingLeaveDays.length
          : leaveSpanDays > 0 ? leave.totalDays * (workingLeaveDays.length / leaveSpanDays) : 0;
      }

      const records = recordsByUser.get(employee.userId) ?? [];
      const recordsByDate = new Map(records.map((record) => [dateKey(record.date), record]));
      let presentDays = 0;
      let halfDays = 0;
      let absentDays = 0;
      let lateArrivals = 0;
      const statuses = new Set<AttendanceStatus>();

      for (const key of workingDateKeys) {
        if (leaveDateKeys.has(key)) {
          statuses.add(AttendanceStatus.LEAVE);
          continue;
        }
        const record = recordsByDate.get(key);
        const completedHours = this.getCompletedHours(record);
        const contribution = this.getAttendanceContribution(record, completedHours);

        if (contribution === 1) {
          presentDays += 1;
          statuses.add(AttendanceStatus.PRESENT);
          if (record?.status === AttendanceStatus.LATE || (record?.clockIn && this.isLateArrival(record.clockIn))) lateArrivals += 1;
        } else if (contribution === 0.5) {
          halfDays += 1;
          statuses.add(AttendanceStatus.HALF_DAY);
          if (record?.status === AttendanceStatus.LATE || (record?.clockIn && this.isLateArrival(record.clockIn))) lateArrivals += 1;
        } else {
          absentDays += 1;
          statuses.add(AttendanceStatus.ABSENT);
        }
      }

      const workingDays = workingDateKeys.size;
      const presentEquivalentDays = presentDays + halfDays * 0.5;
      return {
        employeeId: employee.id,
        empCode: employee.empCode,
        employeeName: details ? `${details.firstName} ${details.lastName}`.trim() : '',
        department: details?.department ?? '',
        team: employee.team,
        workingDays,
        presentDays,
        halfDays,
        absentDays,
        approvedLeaveDays,
        presentEquivalentDays,
        attendancePercentage: workingDays ? Math.round((presentEquivalentDays / workingDays) * 10000) / 100 : 0,
        lateArrivals,
        statuses,
      };
    });

    const filteredRows = query.status
      ? rows.filter((row) => row.statuses.has(query.status!))
      : rows;
    const total = query.status ? filteredRows.length : totalEmployeeCount;
    const selectedPageIds = query.status
      ? filteredRows.slice((page - 1) * pageSize, page * pageSize).map((row) => row.employeeId)
      : pageEmployees.map((employee) => employee.id);
    const pageRows = rows.filter((row) => selectedPageIds.includes(row.employeeId));
    const summary = filteredRows.reduce((totalSummary, row) => ({
      totalEmployees: totalSummary.totalEmployees + 1,
      totalWorkingDays: totalSummary.totalWorkingDays + row.workingDays,
      totalPresentDays: totalSummary.totalPresentDays + row.presentDays,
      totalHalfDays: totalSummary.totalHalfDays + row.halfDays,
      totalAbsentDays: totalSummary.totalAbsentDays + row.absentDays,
      totalApprovedLeaveDays: totalSummary.totalApprovedLeaveDays + row.approvedLeaveDays,
      totalPresentEquivalentDays: totalSummary.totalPresentEquivalentDays + row.presentEquivalentDays,
    }), {
      totalEmployees: 0,
      totalWorkingDays: 0,
      totalPresentDays: 0,
      totalHalfDays: 0,
      totalAbsentDays: 0,
      totalApprovedLeaveDays: 0,
      totalPresentEquivalentDays: 0,
    });

    return {
      data: pageRows.map(({ statuses: _statuses, ...row }) => row),
      meta: { month: query.month, page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      summary: {
        ...summary,
        overallAttendancePercentage: summary.totalWorkingDays
          ? Math.round((summary.totalPresentEquivalentDays / summary.totalWorkingDays) * 10000) / 100
          : 0,
      },
    };
  }

  private getTodayRange() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private parseDateRange(startDate?: string, endDate?: string): DateRange {
    const start = this.parseDate(startDate, false);
    const end = this.parseDate(endDate, true);
    if (start && end && start > end) {
      throw new BadRequestException('startDate cannot be after endDate');
    }
    return { startDate: start, endDate: end };
  }

  private parseDate(value: string | undefined, endOfDay: boolean): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid date: ${value}`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      if (endOfDay) date.setHours(23, 59, 59, 999);
      else date.setHours(0, 0, 0, 0);
    }
    return date;
  }

  private getCompletedHours(record: { clockIn?: Date | null; clockOut?: Date | null; totalHours?: number | null } | undefined) {
    if (!record || !record.clockIn || !record.clockOut) return 0;
    if (record.totalHours != null && Number.isFinite(Number(record.totalHours))) {
      return Number(record.totalHours);
    }
    return (new Date(record.clockOut).getTime() - new Date(record.clockIn).getTime()) / 3600000;
  }

  private getAttendanceContribution(
    record: { clockIn?: Date | null; clockOut?: Date | null; totalHours?: number | null; status?: AttendanceStatus | string } | undefined,
    completedHours: number,
  ) {
    if (!record || !record.clockIn || !record.clockOut) return 0;
    if (completedHours < 4) return 0;
    if (completedHours < 7) return 0.5;
    return 1;
  }

  private isLateArrival(punchIn: Date) {
    const cutoff = new Date(punchIn);
    cutoff.setHours(9, 0, 0, 0);
    return punchIn > cutoff;
  }

  private roundPercentage(value: number) {
    return Math.round(value * 100) / 100;
  }
}
