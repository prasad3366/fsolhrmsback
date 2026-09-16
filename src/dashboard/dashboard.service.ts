import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { AttendanceService } from '../attendance/attendance.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { HolidaysService } from '../holidays/holidays.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { LeaveService } from '../leave/leave.service';
import { WfhService } from '../wfh/wfh.service';

interface RequestUser {
  id?: number;
  role: string;
  employeeId: number | null;
}

interface DashboardEmployee {
  id: number;
  userId?: number | null;
  empCode: string;
  firstName: string;
  lastName: string;
  department?: string;
  status?: string;
  dateOfJoining?: Date | null;
  dateOfExit?: Date | null;
}

interface AttendanceReportRow {
  empCode: string;
  name: string;
  totalDays: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
}

@Injectable()
export class DashboardService {
  private readonly authorizationService: AuthorizationService;
  private readonly attendanceService: AttendanceService;

  constructor(
    private prisma: PrismaService,
    private readonly workingDaysService: WorkingDaysService = new WorkingDaysService(
      prisma,
      new HolidaysService(prisma),
    ),
    attendanceService?: AttendanceService,
    @Optional() private readonly leaveService?: LeaveService,
    @Optional() private readonly wfhService?: WfhService,
  ) {
    this.authorizationService = new AuthorizationService(this.prisma);
    const holidayService =
      (this.workingDaysService as any)?.holidayService ?? new HolidaysService(this.prisma);
    this.attendanceService =
      attendanceService ??
      new AttendanceService(
        this.prisma,
        holidayService,
        undefined,
        this.workingDaysService,
      );
  }

  async getDashboard(user: RequestUser) {
    const role = String(user?.role ?? '').toUpperCase();
    if (role === 'FINANCE_MANAGER') return this.getFinanceDashboard(user);
    if (role === 'EMPLOYEE') return this.getEmployeeDashboard(user);

    const employees = await this.getEmployeesInScope(user);
    const workforce = await this.getTodayWorkforce(employees);
    const pendingLeaves = await this.getPendingLeaves(user);
    const pendingWfh = await this.getPendingWfh(user, role);
    const pendingRegularizations = await this.prisma.attendanceRegularization.count({
      where: {
        status: 'PENDING',
        userId: { in: employees.map((employee) => employee.userId).filter(Boolean) as number[] },
      },
    });

    const response: any = {
      role,
      scope: { employeeCount: employees.length },
      kpis: {
        totalEmployees: employees.length,
        activeEmployees: employees.filter((employee) => employee.status === 'ACTIVE').length,
        presentToday: workforce.present,
        lateToday: workforce.late,
        halfDayToday: workforce.halfDay,
        onLeaveToday: workforce.leave,
        absentToday: workforce.absent,
        inProgressToday: workforce.inProgress,
        pendingLeaveRequests: pendingLeaves.length,
        pendingWfhRequests: pendingWfh.length,
        pendingAttendanceRegularizations: pendingRegularizations,
      },
      workforce,
      departmentSummary: this.getDepartmentSummary(employees, workforce.byEmployee),
      pendingActions: { leave: pendingLeaves, wfh: pendingWfh, attendanceRegularizations: pendingRegularizations },
    };

    if (role === 'HR') {
      const now = new Date();
      const joinerStart = new Date(now);
      joinerStart.setDate(now.getDate() - 30);
      const probationStart = new Date(now);
      probationStart.setMonth(now.getMonth() - 6);
      response.hr = {
        newJoiners: employees.filter((employee) => employee.dateOfJoining && employee.dateOfJoining >= joinerStart).length,
        noticePeriod: employees.filter((employee) => employee.dateOfExit && employee.dateOfExit > now).length,
        probation: await this.prisma.employee.count({ where: { status: 'ACTIVE', isExperienced: false, dateOfJoining: { gte: probationStart } } }),
      };
    }
    return response;
  }

  private async getTodayWorkforce(employees: DashboardEmployee[]) {
    const today = new Date();
    const results = await Promise.all(employees.map(async (employee) => {
      const status = await this.attendanceService.getTodayStatus(employee.userId!, employee.id);
      const eligible = (await this.workingDaysService.getWorkingDates(employee.id, [today])).length > 0;
      return { employee, status: status?.status ?? (eligible ? 'ABSENT' : null) };
    }));
    const counts = { present: 0, late: 0, halfDay: 0, leave: 0, absent: 0, inProgress: 0 };
    const byEmployee = results.map(({ employee, status }) => {
      if (status === 'PRESENT') counts.present += 1;
      if (status === 'LATE') { counts.present += 1; counts.late += 1; }
      if (status === 'HALF_DAY') counts.halfDay += 1;
      if (status === 'LEAVE') counts.leave += 1;
      if (status === 'ABSENT') counts.absent += 1;
      if (status === 'IN_PROGRESS') counts.inProgress += 1;
      return { employeeId: employee.id, department: employee.department ?? 'Unassigned', status };
    });
    return { ...counts, byEmployee };
  }

  private getDepartmentSummary(employees: DashboardEmployee[], today: Array<{ employeeId: number; department: string; status: string | null }>) {
    const summary = new Map<string, any>();
    for (const employee of employees) {
      const department = employee.department?.trim() || 'Unassigned';
      const row = summary.get(department) ?? { department, employeeCount: 0, presentToday: 0, leaveToday: 0, absentToday: 0 };
      row.employeeCount += 1;
      const status = today.find((item) => item.employeeId === employee.id)?.status;
      if (status === 'PRESENT' || status === 'LATE') row.presentToday += 1;
      if (status === 'LEAVE') row.leaveToday += 1;
      if (status === 'ABSENT') row.absentToday += 1;
      summary.set(department, row);
    }
    return [...summary.values()].sort((left, right) => left.department.localeCompare(right.department));
  }

  private async getPendingLeaves(user: RequestUser) {
    if (!this.leaveService || String(user.role).toUpperCase() === 'EMPLOYEE') return [];
    return this.leaveService.pendingRequests(user.role, user as any);
  }

  private async getPendingWfh(user: RequestUser, role: string) {
    if (!['SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER'].includes(role)) return [];
    const teamIds = ['IT_MANAGER', 'SALES_MANAGER'].includes(role)
      ? (await this.prisma.team.findMany({ where: { managerId: Number(user.employeeId) }, select: { id: true } })).map((team) => team.id)
      : undefined;
    if (this.wfhService) {
      const requests = await this.wfhService.getAll(teamIds);
      return requests.filter((request) => request.status === 'PENDING');
    }
    return this.prisma.wFHRequest.findMany({
      where: { status: 'PENDING', ...(teamIds ? { employee: { teamId: { in: teamIds } } } : {}) },
      include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async getFinanceDashboard(user: RequestUser) {
    const [totalEmployees, activeEmployees, payrolls, pendingLeaves] = await Promise.all([
      this.prisma.employee.count(),
      this.prisma.employee.count({ where: { status: 'ACTIVE' } }),
      this.prisma.payroll.findMany({ select: { employeeId: true, status: true, grossSalary: true, netSalary: true, lopDays: true } }),
      this.getPendingLeaves(user),
    ]);
    return {
      role: 'FINANCE_MANAGER',
      kpis: { totalEmployees, activeEmployees, pendingLeaveRequests: pendingLeaves.length, payrollEmployeePopulation: new Set(payrolls.map((payroll) => payroll.employeeId)).size, draftPayrolls: payrolls.filter((payroll) => payroll.status === 'DRAFT').length, finalizedPayrolls: payrolls.filter((payroll) => payroll.status === 'FINALIZED').length, paidPayrolls: payrolls.filter((payroll) => payroll.status === 'PAID').length },
      payroll: { grossTotal: payrolls.reduce((sum, payroll) => sum + payroll.grossSalary, 0), netTotal: payrolls.reduce((sum, payroll) => sum + payroll.netSalary, 0), lopDays: payrolls.reduce((sum, payroll) => sum + payroll.lopDays, 0) },
      pendingActions: { leave: pendingLeaves },
    };
  }

  private async getEmployeeDashboard(user: RequestUser) {
    if (!user.employeeId) throw new ForbiddenException('Employee profile required');
    const employee = await this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { id: true, userId: true, firstName: true, lastName: true, department: true, status: true } });
    if (!employee) throw new ForbiddenException('Employee profile required');
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    const historyResult = await this.attendanceService.getAttendanceHistory(employee.userId, month, year);
    const history = Array.isArray(historyResult) ? historyResult : historyResult.data;
    const statusCounts = history.reduce((counts, record) => { counts[record.status] = (counts[record.status] ?? 0) + 1; return counts; }, {} as Record<string, number>);
    const [today, leaveBalance, leaveHistory, payrolls, wfh] = await Promise.all([
      this.attendanceService.getTodayStatus(employee.userId, employee.id),
      this.leaveService?.selfBalance(employee.id, year) ?? [],
      this.leaveService?.selfLeaveHistory(employee.id) ?? [],
      this.prisma.payroll.findMany({ where: { employeeId: employee.id }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 1 }),
      this.prisma.wFHRequest.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return { role: 'EMPLOYEE', employee, today, month: { presentDays: (statusCounts.PRESENT ?? 0) + (statusCounts.LATE ?? 0), halfDays: statusCounts.HALF_DAY ?? 0, leaveDays: statusCounts.LEAVE ?? 0, absentDays: statusCounts.ABSENT ?? 0 }, leaveBalance, pendingLeaveRequests: leaveHistory.filter((leave) => leave.status === 'PENDING').length, recentLeaveDecisions: leaveHistory.filter((leave) => leave.status !== 'PENDING').slice(0, 5), payroll: payrolls[0] ?? null, wfh };
  }

  private async getEmployeesInScope(user: RequestUser): Promise<DashboardEmployee[]> {
    const role = (user?.role ?? '').toUpperCase();

    if (
      ['SUPER_ADMIN', 'CEO', 'HR'].includes(role) &&
      this.authorizationService.canAccessOrganizationWide(user as any, 'dashboard')
    ) {
      return this.prisma.employee.findMany({
        select: {
          id: true,
          userId: true,
          empCode: true,
          firstName: true,
          lastName: true,
          department: true,
          status: true,
          dateOfJoining: true,
          dateOfExit: true,
        },
      });
    }

    if (role === 'IT_MANAGER' || role === 'SALES_MANAGER') {
      if (!user.employeeId) {
        throw new ForbiddenException('Access denied');
      }

      const teams = await this.prisma.team.findMany({
        where: { managerId: user.employeeId },
        include: { members: true },
      });

      const membersById = new Map<
        number,
        DashboardEmployee
      >();

      for (const team of teams) {
        for (const member of team.members) {
          if (await this.authorizationService.canAccessEmployee(user as any, member.id)) {
            membersById.set(member.id, member);
          }
        }
      }

      return [...membersById.values()];
    }

    throw new ForbiddenException('Access denied');
  }

  async exportAttendanceCsv(month: number, year: number, user: RequestUser) {
    const employees = await this.getEmployeesInScope(user);
    if (!employees.length) {
      return this.toCsv([]);
    }

    const monthDates: Date[] = [];
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      monthDates.push(new Date(date));
    }

    const rows: AttendanceReportRow[] = await Promise.all(
      employees.map(async (employee) => {
        let employeeUserId = employee.userId ?? null;

        if (!employeeUserId && employee.id) {
          const employeeRecord = await this.prisma.employee.findUnique({
            where: { id: employee.id },
            select: { userId: true },
          });
          employeeUserId = employeeRecord?.userId ?? employee.id;
        }

        const historyResult = await this.attendanceService.getAttendanceHistory(
          Number(employeeUserId),
          month,
          year,
        );
        const history = Array.isArray(historyResult) ? historyResult : historyResult.data;

        const workingDates = new Set(
          (await this.workingDaysService.getWorkingDates(employee.id, monthDates)).map((date) =>
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
          ),
        );

        const filteredHistory = history.filter((record) => {
          const dateValue = record.date ?? record.clockIn ?? record.clockOut;
          if (!dateValue) return false;
          const key = `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, '0')}-${String(dateValue.getDate()).padStart(2, '0')}`;
          return workingDates.has(key);
        });

        const totalDays = workingDates.size;
        let presentDays = 0;
        let halfDays = 0;
        let leaveDays = 0;

        for (const record of filteredHistory) {
          if (record.status === 'PRESENT' || record.status === 'LATE') {
            presentDays += 1;
          } else if (record.status === 'HALF_DAY') {
            halfDays += 1;
          } else if (record.status === 'LEAVE') {
            leaveDays += 1;
          }
        }

        const absentDays = totalDays - presentDays - halfDays - leaveDays;

        return {
          empCode: employee.empCode,
          name: `${employee.firstName} ${employee.lastName}`,
          totalDays,
          presentDays,
          halfDays,
          absentDays,
          leaveDays,
        };
      }),
    );

    return this.toCsv(rows);
  }

  private toCsv(rows: AttendanceReportRow[]) {
    const header = [
      'Employee Code',
      'Employee Name',
      'Total Days',
      'Present Days',
      'Half Days',
      'Absent Days',
      'Leave Days',
    ];
    const escape = (value: string | number) => {
      const str = String(value);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push(
        [
          row.empCode,
          row.name,
          row.totalDays,
          row.presentDays,
          row.halfDays,
          row.absentDays,
          row.leaveDays,
        ]
          .map(escape)
          .join(','),
      );
    }

    return lines.join('\n');
  }
}
