import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PunchType, AttendanceStatus } from '@prisma/client';
import { distanceMeters } from './utils/geo.util';
import { OfficeLocationDto } from './dto/office-location.dto';
import { HolidaysService } from '../holidays/holidays.service';

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private holidayService: HolidaysService,
  ) {}

  private today() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  private status(hours: number): AttendanceStatus {
    if (hours < 4) return AttendanceStatus.ABSENT;
    if (hours < 7) return AttendanceStatus.HALF_DAY;
    return AttendanceStatus.PRESENT;
  }

  // ⭐ LOCATION STATUS CHECK
  private async getLocationStatus(
    employeeId: number,
    lat?: number,
    lng?: number,
  ) {
    if (lat === undefined || lng === undefined) return 'OUTSIDE';

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const wfh = await this.prisma.wFHRequest.findFirst({
      where: {
        employeeId,
        status: 'APPROVED',
        startDate: { lte: todayEnd },
        endDate: { gte: todayStart },
      },
    });

    if (wfh) return 'WFH';

    const office = await this.prisma.officeLocation.findFirst();

    if (!office) return 'OUTSIDE';

    const dist = distanceMeters(lat, lng, office.latitude, office.longitude);

    return dist <= office.radius ? 'OFFICE' : 'OUTSIDE';
  }

  // ⭐ PUNCH IN
  async punchIn(employeeId: number, lat?: number, lng?: number) {
    const date = this.today();

    const holiday = await this.holidayService.isHoliday(date);

    if (holiday) {
      return this.prisma.attendance.upsert({
        where: { employeeId_date: { employeeId, date } },
        create: {
          employeeId,
          date,
          status: AttendanceStatus.ABSENT,
          totalHours: 0,
        },
        update: {
          status: AttendanceStatus.ABSENT,
          totalHours: 0,
        },
      });
    }

    const record = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });

    if (record?.punchIn) throw new BadRequestException('Already punched in');

    const locationStatus = await this.getLocationStatus(employeeId, lat, lng);

    await this.prisma.attendanceLog.create({
      data: { employeeId, type: PunchType.IN },
    });

    return this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: {
        employeeId,
        date,
        punchIn: new Date(),
        punchInLat: lat,
        punchInLng: lng,
        locationStatus,
      },
      update: {
        punchIn: new Date(),
        punchInLat: lat,
        punchInLng: lng,
        locationStatus,
      },
    });
  }

  // ⭐ PUNCH OUT
  async punchOut(employeeId: number, lat?: number, lng?: number) {
    const date = this.today();

    const record = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });

    if (!record?.punchIn) throw new BadRequestException('Punch in first');

    if (record.punchOut) throw new BadRequestException('Already punched out');

    const out = new Date();

    const hours = (out.getTime() - record.punchIn.getTime()) / 3600000;

    await this.prisma.attendanceLog.create({
      data: { employeeId, type: PunchType.OUT },
    });

    return this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        punchOut: out,
        punchOutLat: lat,
        punchOutLng: lng,
        totalHours: hours,
        overtime: Math.max(0, hours - 8),
        status: this.status(hours),
      },
    });
  }

  getAll() {
    return this.prisma.attendance.findMany({
      include: { employee: true },
      orderBy: { date: 'desc' },
    });
  }

  getUser(employeeId: number) {
    return this.prisma.attendance.findMany({
      where: { employeeId },
      orderBy: { date: 'desc' },
    });
  }

  async getEmployeeMonthlySummary(employeeId: number, month: string) {
    if (!Number.isInteger(employeeId) || employeeId < 1) {
      throw new BadRequestException('Invalid employee ID');
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) {
      throw new BadRequestException('Month must use YYYY-MM format');
    }

    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;

    if (year < 1) {
      throw new BadRequestException('Month must use YYYY-MM format');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });

    if (!employee) throw new NotFoundException('Employee not found');

    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
    const dateKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    const calendarDates: Date[] = [];
    for (
      let date = new Date(year, monthIndex, 1);
      date <= monthEnd;
      date.setDate(date.getDate() + 1)
    ) {
      calendarDates.push(new Date(date));
    }

    const holidayResults = await Promise.all(
      calendarDates.map((date) => this.holidayService.isHoliday(date)),
    );
    const holidayKeys = new Set(
      holidayResults.filter(Boolean).map((holiday) => dateKey(holiday!.date)),
    );

    const workingDateKeys = new Set(
      calendarDates
        .filter((date) => date.getDay() !== 0 && date.getDay() !== 6)
        .filter((date) => !holidayKeys.has(dateKey(date)))
        .map(dateKey),
    );

    const [attendanceRecords, approvedLeaves] = await Promise.all([
      this.prisma.attendance.findMany({
        where: {
          employeeId,
          date: { gte: monthStart, lte: monthEnd },
        },
      }),
      this.prisma.leave.findMany({
        where: {
          employeeId,
          status: 'APPROVED',
          startDate: { lte: monthEnd },
          endDate: { gte: monthStart },
        },
      }),
    ]);

    const leaveDateKeys = new Set<string>();
    let leaveDays = 0;

    for (const leave of approvedLeaves) {
      const overlapStart = leave.startDate > monthStart ? leave.startDate : monthStart;
      const overlapEnd = leave.endDate < monthEnd ? leave.endDate : monthEnd;
      const overlapDays =
        Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
      const leaveSpanDays =
        Math.floor((leave.endDate.getTime() - leave.startDate.getTime()) / 86400000) + 1;

      if (overlapDays <= 0 || leaveSpanDays <= 0) continue;

      leaveDays +=
        leave.durationType === 'FULL_DAY'
          ? overlapDays
          : leave.totalDays * (overlapDays / leaveSpanDays);

      for (
        let date = new Date(overlapStart.getFullYear(), overlapStart.getMonth(), overlapStart.getDate());
        date <= overlapEnd;
        date.setDate(date.getDate() + 1)
      ) {
        leaveDateKeys.add(dateKey(date));
      }
    }

    const attendanceByDate = new Map(
      attendanceRecords.map((record) => [dateKey(record.date), record]),
    );

    let presentDays = 0;
    let halfDays = 0;
    let absentDays = 0;

    for (const key of workingDateKeys) {
      if (leaveDateKeys.has(key)) continue;

      const record = attendanceByDate.get(key);
      if (record?.status === AttendanceStatus.PRESENT) {
        presentDays += 1;
      } else if (record?.status === AttendanceStatus.HALF_DAY) {
        halfDays += 1;
      } else {
        absentDays += 1;
      }
    }

    const workingDays = workingDateKeys.size;
    const presentEquivalentDays = presentDays + halfDays * 0.5;
    const attendancePercentage =
      workingDays === 0
        ? 0
        : Math.round((presentEquivalentDays / workingDays) * 10000) / 100;

    return {
      employeeId,
      month,
      workingDays,
      presentDays,
      halfDays,
      leaveDays,
      absentDays,
      presentEquivalentDays,
      attendancePercentage,
    };
  }

  async setOfficeLocation(dto: OfficeLocationDto) {
    return this.prisma.officeLocation.upsert({
      where: { id: 1 },
      update: dto,
      create: dto,
    });
  }

  async getMyAttendance(userId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
    });

    if (!employee) throw new BadRequestException('Employee not found');

    return this.prisma.attendance.findMany({
      where: { employeeId: employee.id },
      orderBy: { date: 'desc' },
    });
  }

  async getTodayAttendance(employeeId: number) {
    const today = this.today();
    const record = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    return {
      hasPunchedIn: !!record?.punchIn,
      hasPunchedOut: !!record?.punchOut,
      punchInTime: record?.punchIn || null,
      punchOutTime: record?.punchOut || null,
      locationStatus: record?.locationStatus || null,
      totalHours: record?.totalHours || 0,
      status: record?.status || null,
    };
  }
}
