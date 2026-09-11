import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { HolidaysService } from '../holidays/holidays.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';

interface RequestUser {
  role: string;
  employeeId: number | null;
}

interface AttendanceReportRow {
  empCode: string;
  name: string;
  totalDays: number;
  presentDays: number;
  leaveDays: number;
}

@Injectable()
export class DashboardService {
  private readonly authorizationService: AuthorizationService;

  constructor(
    private prisma: PrismaService,
    private readonly workingDaysService: WorkingDaysService = new WorkingDaysService(
      prisma,
      new HolidaysService(prisma),
    ),
  ) {
    this.authorizationService = new AuthorizationService(this.prisma);
  }

  private async getEmployeesInScope(user: RequestUser) {
    const role = (user?.role ?? '').toUpperCase();

    if (
      ['SUPER_ADMIN', 'CEO', 'HR'].includes(role) &&
      this.authorizationService.canAccessOrganizationWide(user as any, 'dashboard')
    ) {
      return this.prisma.employee.findMany();
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
        { id: number; empCode: string; firstName: string; lastName: string }
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

    const employeeIds = employees.map((e) => e.id);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const monthDates: Date[] = [];
    for (
      let date = new Date(startDate);
      date <= endDate;
      date.setDate(date.getDate() + 1)
    ) {
      monthDates.push(new Date(date));
    }
    const dateKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const workingDatesByEmployee = new Map<number, Set<string>>();

    await Promise.all(
      employees.map(async (employee) => {
        const workingDates = await this.workingDaysService.getWorkingDates(
          employee.id,
          monthDates,
        );
        workingDatesByEmployee.set(
          employee.id,
          new Set(workingDates.map(dateKey)),
        );
      }),
    );

    const [attendanceRecords, leaves] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: {
          user: { employee: { id: { in: employeeIds } } },
          date: { gte: startDate, lte: endDate },
        },
        include: { user: { include: { employee: true } } },
      }),
      this.prisma.leave.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: 'APPROVED',
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
    ]);

    const presentDaysByEmployee = new Map<number, number>();
    for (const att of attendanceRecords) {
      const employeeId = att.user.employee?.id;
      if (!employeeId || !workingDatesByEmployee.get(employeeId)?.has(dateKey(att.date))) {
        continue;
      }

      const hasClockIn = !!att.clockIn;
      const hasClockOut = !!att.clockOut;
      if (hasClockIn && !hasClockOut) {
        continue;
      }

      if (!hasClockIn || !hasClockOut) {
        continue;
      }

      const clockIn = att.clockIn;
      const clockOut = att.clockOut;
      if (!clockIn || !clockOut) {
        continue;
      }

      const durationHours = (new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 3600000;
      const current = presentDaysByEmployee.get(employeeId) || 0;
      if (durationHours < 4) {
        // ABSENT: no contribution to presentDays
        continue;
      }
      if (durationHours < 7) {
        presentDaysByEmployee.set(employeeId, current + 0.5);
        continue;
      }
      presentDaysByEmployee.set(employeeId, current + 1);
    }

    const leaveDaysByEmployee = new Map<number, number>();
    for (const leave of leaves) {
      if (leave.status !== 'APPROVED') continue;
      const overlapStart = leave.startDate < startDate ? startDate : leave.startDate;
      const overlapEnd = leave.endDate > endDate ? endDate : leave.endDate;
      const datesBetween = (rangeStart: Date, rangeEnd: Date) => {
        const dates: Date[] = [];
        for (
          let date = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
          date <= rangeEnd;
          date.setDate(date.getDate() + 1)
        ) {
          dates.push(new Date(date));
        }
        return dates;
      };
      const fullLeaveDates = datesBetween(leave.startDate, leave.endDate);
      const overlapDates = datesBetween(overlapStart, overlapEnd);
      const [fullWorkingDates, overlapWorkingDates] = await Promise.all([
        this.workingDaysService.getWorkingDates(leave.employeeId, fullLeaveDates),
        this.workingDaysService.getWorkingDates(leave.employeeId, overlapDates),
      ]);
      const proratedDays = fullWorkingDates.length
        ? leave.totalDays * (overlapWorkingDates.length / fullWorkingDates.length)
        : 0;
      const current = leaveDaysByEmployee.get(leave.employeeId) || 0;
      leaveDaysByEmployee.set(leave.employeeId, current + proratedDays);
    }

    const rows: AttendanceReportRow[] = employees.map((emp) => ({
      empCode: emp.empCode,
      name: `${emp.firstName} ${emp.lastName}`,
      totalDays: workingDatesByEmployee.get(emp.id)?.size || 0,
      presentDays: presentDaysByEmployee.get(emp.id) || 0,
      leaveDays: Math.round((leaveDaysByEmployee.get(emp.id) || 0) * 100) / 100,
    }));

    return this.toCsv(rows);
  }

  private toCsv(rows: AttendanceReportRow[]) {
    const header = ['Employee Code', 'Employee Name', 'Total Days', 'Present Days', 'Leave Days'];
    const escape = (value: string | number) => {
      const str = String(value);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push(
        [row.empCode, row.name, row.totalDays, row.presentDays, row.leaveDays]
          .map(escape)
          .join(','),
      );
    }

    return lines.join('\n');
  }
}
