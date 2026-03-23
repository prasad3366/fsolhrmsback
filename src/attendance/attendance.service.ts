import { Injectable, BadRequestException } from '@nestjs/common';
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
}
