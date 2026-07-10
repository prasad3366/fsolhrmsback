import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private prisma: PrismaService) {}

  /* HR/Admin see every employee; a manager only sees their own team's members */

  private async getEmployeesInScope(user: RequestUser) {
    if (user.role === 'MANAGER') {
      if (!user.employeeId) return [];

      const teams = await this.prisma.team.findMany({
        where: { managerId: user.employeeId },
        include: { members: true },
      });

      const membersById = new Map<number, { id: number; empCode: string; firstName: string; lastName: string }>();
      for (const team of teams) {
        for (const member of team.members) {
          membersById.set(member.id, member);
        }
      }

      return [...membersById.values()];
    }

    return this.prisma.employee.findMany();
  }

  async exportAttendanceCsv(month: number, year: number, user: RequestUser) {
    const employees = await this.getEmployeesInScope(user);
    if (!employees.length) {
      return this.toCsv([]);
    }

    const employeeIds = employees.map((e) => e.id);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const totalDaysInMonth = endDate.getDate();

    const [attendanceRecords, leaves] = await Promise.all([
      this.prisma.attendance.findMany({
        where: {
          employeeId: { in: employeeIds },
          date: { gte: startDate, lte: endDate },
        },
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
      const current = presentDaysByEmployee.get(att.employeeId) || 0;
      if (att.status === 'PRESENT') {
        presentDaysByEmployee.set(att.employeeId, current + 1);
      } else if (att.status === 'HALF_DAY') {
        presentDaysByEmployee.set(att.employeeId, current + 0.5);
      }
    }

    const leaveDaysByEmployee = new Map<number, number>();
    for (const leave of leaves) {
      // Prorate leaves spanning a month boundary so only the days
      // that fall inside this reporting month are counted.
      const overlapStart = leave.startDate < startDate ? startDate : leave.startDate;
      const overlapEnd = leave.endDate > endDate ? endDate : leave.endDate;
      const overlapDays =
        Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
      const leaveSpanDays =
        Math.floor((leave.endDate.getTime() - leave.startDate.getTime()) / 86400000) + 1;

      const proratedDays = leave.totalDays * (overlapDays / leaveSpanDays);
      const current = leaveDaysByEmployee.get(leave.employeeId) || 0;
      leaveDaysByEmployee.set(leave.employeeId, current + proratedDays);
    }

    const rows: AttendanceReportRow[] = employees.map((emp) => ({
      empCode: emp.empCode,
      name: `${emp.firstName} ${emp.lastName}`,
      totalDays: totalDaysInMonth,
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
