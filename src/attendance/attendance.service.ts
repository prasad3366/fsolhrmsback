import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AttendanceStatus,
  EmployeeStatus,
  RegularizationStatus,
} from '@prisma/client';
import { distanceMeters } from './utils/geo.util';
import { OfficeLocationDto } from './dto/office-location.dto';
import { HolidaysService } from '../holidays/holidays.service';
import {
  AuthorizationService,
  AuthorizationUser,
} from '../common/authorization/authorization.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';

@Injectable()
export class AttendanceService {
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
  ) {}

  private attendanceDate(value = new Date()) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  private policyTime(date: Date, value: string) {
    const [hours, minutes] = value.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours || 0, minutes || 0, 0, 0);
    return result;
  }

  private async clockInWithClient(client: any, userId: number, userEmail: string, ipAddress?: string) {
    const date = this.attendanceDate();
    const existing = await client.attendanceRecord.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (existing?.clockIn) throw new BadRequestException('Already clocked in');

    const policy = await client.attendancePolicy.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
    const clockIn = new Date();
    const lateAfter = this.policyTime(date, policy.shiftStartTime);
    lateAfter.setMinutes(lateAfter.getMinutes() + policy.gracePeriodMins);
    const isLate = clockIn > lateAfter;

    return client.attendanceRecord.create({
      data: {
        userId,
        userEmail,
        date,
        clockIn,
        ipAddress,
        isLate,
        status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
      },
    });
  }

  async clockIn(userId: number, userEmail: string, ipAddress?: string) {
    return this.clockInWithClient(this.prisma, userId, userEmail, ipAddress);
  }

  private async clockOutWithClient(
    client: any,
    userId: number,
    date = new Date(),
    userEmail = '',
  ) {
    const attendanceDate = this.attendanceDate(date);
    const dayEnd = new Date(attendanceDate);
    dayEnd.setHours(23, 59, 59, 999);
    const record = client.attendanceRecord.findFirst
      ? await client.attendanceRecord.findFirst({
          where: {
            userId,
            date: { gte: attendanceDate, lte: dayEnd },
          },
          orderBy: { date: 'desc' },
        })
      : await client.attendanceRecord.findUnique({
          where: { userId_date: { userId, date: attendanceDate } },
        });

    const clockOut = new Date();
    if (!record) {
      return client.attendanceRecord.create({
        data: {
          userId,
          userEmail,
          date: attendanceDate,
          clockIn: clockOut,
          clockOut,
          totalHours: 0,
          status: this.status(0),
        },
      });
    }
    if (record.clockOut) throw new BadRequestException('Already clocked out');

    const totalHours = (clockOut.getTime() - record.clockIn.getTime()) / 3600000;
    const policy = await client.attendancePolicy.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
    const earlyBefore = this.policyTime(attendanceDate, policy.shiftEndTime);
    earlyBefore.setMinutes(earlyBefore.getMinutes() - policy.earlyCheckoutMins);
    const isEarlyCheckout = clockOut < earlyBefore;
    const status = this.status(totalHours);

    return client.attendanceRecord.update({
      where: { id: record.id },
      data: { clockOut, totalHours, isEarlyCheckout, status },
    });
  }

  async clockOut(userId: number, date = new Date()) {
    return this.clockOutWithClient(this.prisma, userId, date);
  }

  async getTodayStatus(userId: number) {
    const date = this.attendanceDate();
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!record) return { clockedIn: false, clockedOut: false, durationElapsed: 0 };

    const end = record.clockOut ?? new Date();
    return {
      ...record,
      clockedIn: true,
      clockedOut: Boolean(record.clockOut),
      durationElapsed: Math.max(0, (end.getTime() - record.clockIn.getTime()) / 3600000),
    };
  }

  async getTodayStatusForEmployee(employeeId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });

    if (!employee) throw new BadRequestException('Employee not found');

    return this.getTodayStatus(employee.userId);
  }

  async getAttendanceEmployees(request: any, search?: string) {
    const user = request?.user;
    const employeeId = Number(user?.employeeId);
    const role = String(user?.role ?? '').toUpperCase();

    if (!user || !Number.isInteger(employeeId) || employeeId <= 0) {
      throw new ForbiddenException('Access denied');
    }

    let scopeWhere: any;
    if (role === 'SUPER_ADMIN' || role === 'CEO' || role === 'HR') {
      scopeWhere = { status: EmployeeStatus.ACTIVE };
    } else if (role === 'SALES_MANAGER' || role === 'IT_MANAGER') {
      const assignedTeams = await this.prisma.team.findMany({
        where: { managerId: employeeId },
        select: { id: true },
      });
      scopeWhere = {
        teamId: { in: assignedTeams.map((team) => team.id) },
      };
    } else if (role === 'EMPLOYEE') {
      scopeWhere = { id: employeeId };
    } else {
      throw new ForbiddenException('Access denied');
    }

    const normalizedSearch = String(search ?? '').trim();
    const searchNumber = Number(normalizedSearch);
    const searchConditions = normalizedSearch
      ? {
          OR: [
            ...(Number.isInteger(searchNumber) && searchNumber > 0
              ? [{ id: searchNumber }]
              : []),
            { firstName: { contains: normalizedSearch, mode: 'insensitive' } },
            { lastName: { contains: normalizedSearch, mode: 'insensitive' } },
            { empCode: { contains: normalizedSearch, mode: 'insensitive' } },
          ],
        }
      : undefined;

    return this.prisma.employee.findMany({
      where: searchConditions ? { AND: [scopeWhere, searchConditions] } : scopeWhere,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        empCode: true,
        designation: true,
        teamId: true,
      },
    });
  }

  async getAttendanceHistory(
    userId: number,
    month?: number,
    year?: number,
    status?: AttendanceStatus,
    page?: number,
    pageSize?: number,
  ) {
    const shouldPaginate = page !== undefined || pageSize !== undefined;
    const normalizedPage = page ?? 1;
    const normalizedPageSize = pageSize ?? 10;

    const paginate = (records: any[], resultMonth: number, resultYear: number) => {
      if (!shouldPaginate) return records;

      const total = records.length;
      const totalPages = Math.ceil(total / normalizedPageSize);
      const start = (normalizedPage - 1) * normalizedPageSize;
      return {
        data: records
          .slice()
          .sort((left, right) => right.date.getTime() - left.date.getTime())
          .slice(start, start + normalizedPageSize),
        meta: {
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total,
          totalPages,
          month: resultMonth,
          year: resultYear,
        },
      };
    };

    if (!month || !year) {
      return this.prisma.attendanceRecord.findMany({
        where: { userId, ...(status && { status }) },
        orderBy: { date: 'asc' },
      });
    }

    const monthStart = new Date(year, month - 1, 1);
    const nextMonthStart = new Date(year, month, 1);
    const monthEnd = new Date(nextMonthStart.getTime() - 1);
    const today = new Date();
    const todayEnd = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      23,
      59,
      59,
      999,
    );
    const isCurrentMonth =
      year === today.getFullYear() && month === today.getMonth() + 1;
    if (monthStart > todayEnd) return shouldPaginate
      ? paginate([], month, year)
      : [];
    const calculationEndDate = monthEnd < todayEnd ? monthEnd : todayEnd;
    const dateRange = isCurrentMonth
      ? { gte: monthStart, lte: calculationEndDate }
      : { gte: monthStart, lt: nextMonthStart };
    const employee = this.prisma.employee?.findUnique
      ? await this.prisma.employee.findUnique({
          where: { userId },
          select: { id: true },
        })
      : null;
    if (!employee) {
      const records = await this.prisma.attendanceRecord.findMany({
        where: {
          userId,
          date: dateRange,
          ...(status && { status }),
        },
        orderBy: { date: 'asc' },
      });
      const filteredRecords = status
        ? records.filter((record) => record.status === status)
        : records;
      return paginate(filteredRecords, month, year);
    }

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        userId,
        date: dateRange,
      },
      orderBy: { date: 'asc' },
    });

    const monthDates: Date[] = [];
    for (
      let date = new Date(year, month - 1, 1);
      date <= calculationEndDate;
      date.setDate(date.getDate() + 1)
    ) {
      monthDates.push(new Date(date));
    }

    const dateKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const recordDates = new Set(records.map((record) => dateKey(record.date)));
    const workingDates = await this.workingDaysService.getWorkingDates(
      employee.id,
      monthDates,
    );
    const inferredAbsences = workingDates
      .filter((date) => !recordDates.has(dateKey(date)))
      .map((date) => ({
        userId,
        date,
        clockIn: null,
        clockOut: null,
        totalHours: 0,
        status: AttendanceStatus.ABSENT,
      }));
    const allRecords = [...records, ...inferredAbsences].sort(
      (left, right) => left.date.getTime() - right.date.getTime(),
    );

    const filteredRecords = status
      ? allRecords.filter((record) => record.status === status)
      : allRecords;
    return paginate(filteredRecords, month, year);
  }

  async requestRegularization(dto: any, userId: number, userEmail: string) {
    const requestedClockIn = new Date(dto.requestedClockIn);
    const attendanceDate = this.attendanceDate(requestedClockIn);
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: attendanceDate } },
    });
    if (!record) throw new NotFoundException('Attendance record not found');

    return this.prisma.attendanceRegularization.create({
      data: {
        attendanceRecordId: record.id,
        userId,
        userEmail,
        requestedClockIn,
        requestedClockOut: new Date(dto.requestedClockOut),
        reason: dto.reason,
      },
    });
  }

  getRegularizations(status: RegularizationStatus = RegularizationStatus.PENDING) {
    return this.prisma.attendanceRegularization.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
    });
  }

  async processRegularization(
    id: number,
    status: RegularizationStatus,
    approverEmail: string,
    rejectionReason?: string,
  ) {
    if (
      ([RegularizationStatus.APPROVED, RegularizationStatus.REJECTED] as RegularizationStatus[]).includes(
        status,
      ) === false
    ) {
      throw new BadRequestException('Status must be APPROVED or REJECTED');
    }
    const request = await this.prisma.attendanceRegularization.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Regularization request not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceRegularization.update({
        where: { id },
        data: { status, approvedBy: approverEmail, rejectionReason },
      });
      if (status === RegularizationStatus.APPROVED) {
        const totalHours = (request.requestedClockOut.getTime() - request.requestedClockIn.getTime()) / 3600000;
        const policy = await tx.attendancePolicy.upsert({
          where: { id: 1 },
          create: { id: 1 },
          update: {},
        });
        const attendanceDate = this.attendanceDate(request.requestedClockIn);
        const lateAfter = this.policyTime(attendanceDate, policy.shiftStartTime);
        lateAfter.setMinutes(lateAfter.getMinutes() + policy.gracePeriodMins);
        const earlyBefore = this.policyTime(attendanceDate, policy.shiftEndTime);
        earlyBefore.setMinutes(earlyBefore.getMinutes() - policy.earlyCheckoutMins);
        const isLate = request.requestedClockIn > lateAfter;
        const isEarlyCheckout = request.requestedClockOut < earlyBefore;
        await tx.attendanceRecord.update({
          where: { id: request.attendanceRecordId },
          data: {
            clockIn: request.requestedClockIn,
            clockOut: request.requestedClockOut,
            totalHours,
            isLate,
            isEarlyCheckout,
            status: totalHours < policy.halfDayHours
              ? AttendanceStatus.HALF_DAY
              : isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
          },
        });
      }
      return updated;
    });
  }

  private today() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  private status(hours: number): AttendanceStatus {
    if (hours < 4) return AttendanceStatus.ABSENT;
    if (hours < 7) return AttendanceStatus.HALF_DAY;
    return AttendanceStatus.PRESENT;
  }

  private async requireActiveEmployee(employeeId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, status: true },
    });

    if (!employee) throw new BadRequestException('Employee not found');
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new ForbiddenException('Employee is inactive');
    }
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

    const workingDate = new Date(
      todayStart.getFullYear(),
      todayStart.getMonth(),
      todayStart.getDate(),
    );
    const workingDates = await this.workingDaysService.getWorkingDates(employeeId, [
      workingDate,
    ]);

    if (workingDates.length === 0) {
      return 'OUTSIDE';
    }

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
    await this.requireActiveEmployee(employeeId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true, user: { select: { email: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const locationStatus = await this.getLocationStatus(employeeId, lat, lng);
    const date = this.attendanceDate();
    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });
    if (existing?.punchIn) throw new BadRequestException('Already clocked in');
    return await this.prisma.$transaction(async (tx) => {
      if (tx.attendanceRecord) {
        const result = await this.clockInWithClient(tx, employee.userId, employee.user.email);
        await tx.attendanceLog.create({
          data: { employeeId, type: 'IN', time: result.clockIn },
        });
        return { ...result, locationStatus };
      }

      const punchIn = new Date();
      await tx.attendanceLog.create({ data: { employeeId, type: 'IN' } });
      return tx.attendance.upsert({
        where: { employeeId_date: { employeeId, date } },
        update: { punchIn, punchInLat: lat, punchInLng: lng, locationStatus },
        create: { employeeId, date, punchIn, punchInLat: lat, punchInLng: lng, locationStatus },
      });
    });
  }

  // ⭐ PUNCH OUT
  async punchOut(employeeId: number, lat?: number, lng?: number) {
    await this.requireActiveEmployee(employeeId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true, user: { select: { email: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return await this.prisma.$transaction(async (tx) => {
      if (tx.attendanceRecord) {
        const result = await this.clockOutWithClient(
          tx,
          employee.userId,
          new Date(),
          employee.user?.email ?? '',
        );
        await tx.attendanceLog.create({
          data: { employeeId, type: 'OUT', time: result.clockOut },
        });
        return result;
      }

      const date = this.attendanceDate();
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      const record = tx.attendance.findFirst
        ? await tx.attendance.findFirst({
            where: { employeeId, date: { gte: date, lte: dayEnd } },
            orderBy: { date: 'desc' },
          })
        : await tx.attendance.findUnique({
            where: { employeeId_date: { employeeId, date } },
          });
      const punchOut = new Date();
      if (!record) {
        await tx.attendanceLog.create({ data: { employeeId, type: 'OUT' } });
        return tx.attendance.upsert({
          where: { employeeId_date: { employeeId, date } },
          update: { punchOut, punchOutLat: lat, punchOutLng: lng, totalHours: 0 },
          create: {
            employeeId,
            date,
            punchIn: punchOut,
            punchOut,
            punchOutLat: lat,
            punchOutLng: lng,
            totalHours: 0,
          },
        });
      }
      if (record.punchOut) throw new BadRequestException('Already clocked out');
      const totalHours = record.punchIn
        ? (punchOut.getTime() - record.punchIn.getTime()) / 3600000
        : 0;
      await tx.attendanceLog.create({ data: { employeeId, type: 'OUT' } });
      return tx.attendance.update({
        where: { id: record.id },
        data: { punchOut, punchOutLat: lat, punchOutLng: lng, totalHours },
      });
    });
  }

  getAll() {
    return this.prisma.attendanceRecord.findMany({
      include: { user: { include: { employee: true } } },
      orderBy: { date: 'desc' },
    });
  }

  getUser(employeeId: number) {
    return this.prisma.attendanceRecord.findMany({
      where: { user: { employee: { id: employeeId } } },
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
      select: { id: true, userId: true },
    });

    if (!employee) throw new NotFoundException('Employee not found');

    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
    const today = new Date();
    const isCurrentMonth =
      year === today.getFullYear() && monthIndex === today.getMonth();
    const isFutureMonth =
      year > today.getFullYear() ||
      (year === today.getFullYear() && monthIndex > today.getMonth());

    if (isFutureMonth) {
      return {
        employeeId,
        month,
        workingDays: 0,
        presentDays: 0,
        halfDays: 0,
        leaveDays: 0,
        absentDays: 0,
        presentEquivalentDays: 0,
        attendancePercentage: 0,
      };
    }

    const calculationEndDate = isCurrentMonth
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)
      : monthEnd;
    const dateKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    const calendarDates: Date[] = [];
    for (
      let date = new Date(year, monthIndex, 1);
      date <= calculationEndDate;
      date.setDate(date.getDate() + 1)
    ) {
      calendarDates.push(new Date(date));
    }

    const workingDateKeys = new Set(
      (await this.workingDaysService.getWorkingDates(employeeId, calendarDates)).map(dateKey),
    );

    const [attendanceRecordsResult, approvedLeaves] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: {
          userId: employee.userId,
          date: { gte: monthStart, lte: calculationEndDate },
        },
      }),
      this.prisma.leave.findMany({
        where: {
          employeeId,
          status: 'APPROVED',
          startDate: { lte: calculationEndDate },
          endDate: { gte: monthStart },
        },
      }),
    ]);
    const attendanceRecords = attendanceRecordsResult ?? [];

    const leaveDateKeys = new Set<string>();
    let leaveDays = 0;

    for (const leave of approvedLeaves) {
      const overlapStart = leave.startDate > monthStart ? leave.startDate : monthStart;
      const overlapEnd =
        leave.endDate < calculationEndDate ? leave.endDate : calculationEndDate;
      const overlapDays =
        Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
      const leaveSpanDays =
        Math.floor((leave.endDate.getTime() - leave.startDate.getTime()) / 86400000) + 1;

      if (overlapDays <= 0 || leaveSpanDays <= 0) continue;

      let workingDaysInLeave = 0;
      for (
        let date = new Date(overlapStart.getFullYear(), overlapStart.getMonth(), overlapStart.getDate());
        date <= overlapEnd;
        date.setDate(date.getDate() + 1)
      ) {
        const key = dateKey(date);
        leaveDateKeys.add(key);

        if (workingDateKeys.has(key)) {
          workingDaysInLeave += 1;
        }
      }

      leaveDays +=
        leave.durationType === 'FULL_DAY'
          ? workingDaysInLeave
          : leave.totalDays * (workingDaysInLeave / leaveSpanDays);
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

  async getTargetEmployeeAttendanceSummary(
    user: AuthorizationUser | undefined,
    employeeId: number,
    month: string,
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

    return this.getEmployeeMonthlySummary(employeeId, month);
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

    return this.prisma.attendanceRecord.findMany({
      where: { userId: employee.userId },
      orderBy: { date: 'desc' },
    });
  }

  async getMyAttendanceForEmployee(
    employeeId: number,
    month?: number,
    year?: number,
    status?: AttendanceStatus,
    page?: number,
    pageSize?: number,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) throw new BadRequestException('Employee not found');

    return this.getAttendanceHistory(employee.userId, month, year, status, page, pageSize);
  }

  async getTodayAttendance(employeeId: number) {
    await this.requireActiveEmployee(employeeId);

    const today = this.today();
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId: employee.userId, date: today } },
    });
    return {
      hasPunchedIn: !!record?.clockIn,
      hasPunchedOut: !!record?.clockOut,
      punchInTime: record?.clockIn || null,
      punchOutTime: record?.clockOut || null,
      locationStatus: null,
      totalHours: record?.totalHours || 0,
      status: record?.status || null,
    };
  }
}
