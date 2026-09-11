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
import {
  getBusinessDateKey,
  getCurrentDayCutoff,
  getMonthRange,
  toBusinessDate,
} from './utils/business-date.util';

@Injectable()
export class AttendanceService {
  private readonly workingDaysService: {
    getWorkingDates: (employeeId: number, dates: Date[]) => Promise<Date[]>;
  };

  constructor(
    private prisma: PrismaService,
    private holidayService: HolidaysService,
    private readonly authorizationService: AuthorizationService = new AuthorizationService(
      prisma,
    ),
    workingDaysService?: WorkingDaysService,
  ) {
    this.workingDaysService =
      workingDaysService ?? {
        async getWorkingDates(_employeeId: number, dates: Date[]) {
          return dates;
        },
      };
  }

  private attendanceDate(value = new Date()) {
    return toBusinessDate(value);
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

    try {
      return await client.attendanceRecord.create({
        data: {
          userId,
          userEmail,
          date,
          clockIn,
          clockOut: null,
          totalHours: null,
          ipAddress,
          isLate,
          status: AttendanceStatus.IN_PROGRESS,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException('Already clocked in');
      }
      throw error;
    }
  }

  async clockIn(userId: number, userEmail: string, ipAddress?: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true, status: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new ForbiddenException('Employee is inactive');
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.clockInWithClient(tx, userId, userEmail, ipAddress);
      await tx.attendanceLog.create({
        data: { employeeId: employee.id, type: 'IN', time: result.clockIn },
      });
      return result;
    });
  }

  private async clockOutWithClient(
    client: any,
    userId: number,
    date = new Date(),
    userEmail = '',
  ) {
    const attendanceDate = this.attendanceDate(date);
    const record = await client.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: attendanceDate } },
    });

    const clockOut = new Date();
    if (!record) throw new BadRequestException('No active check-in found');
    if (!record.clockIn) throw new BadRequestException('Clock-in is required');

    const totalHours = (clockOut.getTime() - record.clockIn.getTime()) / 3600000;
    if (totalHours <= 0) {
      throw new BadRequestException('Clock-out must be after clock-in');
    }
    const policy = await client.attendancePolicy.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
    const earlyBefore = this.policyTime(attendanceDate, policy.shiftEndTime);
    earlyBefore.setMinutes(earlyBefore.getMinutes() - policy.earlyCheckoutMins);
    const isEarlyCheckout = clockOut < earlyBefore;
    const status = this.classifyCompletedDuration(totalHours);

    const closeResult = await client.attendanceRecord.updateMany({
      where: {
        userId,
        date: attendanceDate,
        clockIn: { gte: new Date(0) },
        clockOut: null,
      },
      data: { clockOut, totalHours, isEarlyCheckout, status },
    });

    if (closeResult.count === 0) {
      throw new BadRequestException('Already clocked out');
    }

    return client.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: attendanceDate } },
    });
  }

  async clockOut(userId: number, date = new Date()) {
    if (this.attendanceDate(date).getTime() !== this.attendanceDate().getTime()) {
      throw new BadRequestException('Historical clock-out is not allowed');
    }
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true, status: true, user: { select: { email: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new ForbiddenException('Employee is inactive');
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.clockOutWithClient(
        tx,
        userId,
        new Date(),
        employee.user?.email ?? '',
      );
      await tx.attendanceLog.create({
        data: { employeeId: employee.id, type: 'OUT', time: result.clockOut },
      });
      return result;
    });
  }

  async getTodayStatus(userId: number, employeeId?: number) {
    const date = this.attendanceDate();
    const employee = employeeId
      ? { id: employeeId }
      : this.prisma.employee?.findUnique
      ? await this.prisma.employee.findUnique({
          where: { userId },
          select: { id: true },
        })
      : null;
    const record = this.prisma.attendanceRecord?.findUnique
      ? await this.prisma.attendanceRecord.findUnique({
          where: { userId_date: { userId, date } },
        })
      : null;
    const attendanceByDate = record ? new Map([[getBusinessDateKey(date), this.effectiveRecord(record)]]) : new Map();
    const statusByDate = employee
      ? await this.buildLeaveAwareStatusMap(employee.id, [date], attendanceByDate)
      : new Map();
    const derivedStatus = statusByDate.get(getBusinessDateKey(date)) ?? (record ? this.effectiveStatus(record) : null);
    const status = !record && derivedStatus === AttendanceStatus.ABSENT ? null : derivedStatus;

    if (!record && !status) {
      return {
        hasPunchedIn: false,
        hasPunchedOut: false,
        punchInTime: null,
        punchOutTime: null,
        clockIn: null,
        clockOut: null,
        locationStatus: null,
        totalHours: null,
        status: null,
        state: 'NOT_CHECKED_IN',
        clockedIn: false,
        clockedOut: false,
        durationElapsed: 0,
      };
    }

    if (status === AttendanceStatus.LEAVE) {
      return {
        hasPunchedIn: false,
        hasPunchedOut: false,
        punchInTime: null,
        punchOutTime: null,
        clockIn: null,
        clockOut: null,
        locationStatus: null,
        totalHours: null,
        state: 'LEAVE',
        clockedIn: false,
        clockedOut: false,
        durationElapsed: 0,
        status,
      };
    }

    const end = record?.clockOut ?? new Date();
    return {
      ...record,
      hasPunchedIn: !!record?.clockIn,
      hasPunchedOut: !!record?.clockOut,
      punchInTime: record?.clockIn ?? null,
      punchOutTime: record?.clockOut ?? null,
      locationStatus: null,
      status,
      state: record?.clockOut ? 'COMPLETED' : 'IN_PROGRESS',
      clockedIn: !!record?.clockIn,
      clockedOut: Boolean(record?.clockOut),
      durationElapsed: record ? Math.max(0, (end.getTime() - record.clockIn.getTime()) / 3600000) : 0,
    };
  }

  async getTodayStatusForEmployee(employeeId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });

    if (!employee) throw new BadRequestException('Employee not found');

    return this.getTodayStatus(employee.userId, employeeId);
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
    } else if (role === 'FINANCE_MANAGER') {
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

    const paginate = (records: any[], resultMonth: number, resultYear: number) => {
      if (!shouldPaginate) return records;

      const total = records.length;
      return {
        data: records
          .slice()
          .sort((left, right) => right.date.getTime() - left.date.getTime()),
        meta: {
          page: 1,
          pageSize: Math.max(total, 1),
          total,
          totalPages: 1,
          month: resultMonth,
          year: resultYear,
        },
      };
    };

    if (!month || !year) {
      return this.prisma.attendanceRecord.findMany({
        where: { userId },
        orderBy: { date: 'asc' },
      }).then((records) => records
        .map((record) => this.effectiveRecord(record))
        .filter((record) => !status || record.status === status));
    }

    const { start: monthStart } = getMonthRange(year, month);
    const today = new Date();
    const todayKey = getBusinessDateKey(today).split('-').map(Number);
    const isCurrentMonth = year === todayKey[0] && month === todayKey[1];
    if (monthStart >= getCurrentDayCutoff(today)) return shouldPaginate
      ? paginate([], month, year)
      : [];
    const monthDateKeys = new Set<string>();
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const endDay = isCurrentMonth ? todayKey[2] : lastDayOfMonth;
    const monthDates: Date[] = [];
    for (let day = 1; day <= endDay; day += 1) {
      const date = new Date(Date.UTC(year, month - 1, day, 12));
      monthDates.push(date);
      monthDateKeys.add(getBusinessDateKey(date));
    }
    const employee = this.prisma.employee?.findUnique
      ? await this.prisma.employee.findUnique({
          where: { userId },
          select: { id: true },
        })
      : null;
    if (!employee) {
      const records = await this.prisma.attendanceRecord.findMany({
        where: { userId },
      });
      const effectiveRecords = records
        .map((record) => this.effectiveRecord(record))
        .filter((record) => monthDateKeys.has(getBusinessDateKey(record.clockIn ?? record.date)));
      const filteredRecords = status
        ? effectiveRecords.filter((record) => record.status === status)
        : effectiveRecords;
      return paginate(filteredRecords, month, year);
    }

    const records = (await this.prisma.attendanceRecord.findMany({
      where: { userId },
    })).map((record) => this.effectiveRecord(record));
    const monthRecords = records.filter((record) =>
      monthDateKeys.has(getBusinessDateKey(record.clockIn ?? record.date)),
    );

    const recordBusinessDateKey = (record: { date: Date; clockIn?: Date | null }) =>
      getBusinessDateKey(record.clockIn ?? record.date);
    const attendanceByDate = new Map(monthRecords.map((record) => [recordBusinessDateKey(record), record]));
    const statusByDate = await this.buildLeaveAwareStatusMap(employee.id, monthDates, attendanceByDate);
    const workingDates = await this.workingDaysService.getWorkingDates(employee.id, monthDates);
    const recordDates = new Set(monthRecords.map(recordBusinessDateKey));
    const inferredAbsences = workingDates
      .filter((date) => !recordDates.has(getBusinessDateKey(date)))
      .map((date) => ({
        userId,
        date,
        clockIn: null,
        clockOut: null,
        totalHours: 0,
        status: AttendanceStatus.ABSENT,
      }));

    const allRecords = [...monthRecords, ...inferredAbsences]
      .map((record) => {
        const key = recordBusinessDateKey(record);
        const overrideStatus = statusByDate.get(key);
        if (!overrideStatus) return record;

        const isLeaveOrAbsent =
          overrideStatus === AttendanceStatus.LEAVE ||
          overrideStatus === AttendanceStatus.ABSENT;

        if (record.clockIn) {
          return { ...record, status: overrideStatus };
        }

        return isLeaveOrAbsent
          ? {
              ...record,
              status: overrideStatus,
              clockIn: null,
              clockOut: null,
              totalHours: 0,
            }
          : { ...record, status: overrideStatus };
      })
      .sort((left, right) => left.date.getTime() - right.date.getTime());

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
        if (totalHours <= 0) {
          throw new BadRequestException('Requested clock-out must be after clock-in');
        }
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
            status: this.classifyCompletedDuration(totalHours),
          },
        });
      }
      return updated;
    });
  }

  private today() {
    return toBusinessDate();
  }

  private classifyCompletedDuration(hours: number): AttendanceStatus {
    if (hours < 4) return AttendanceStatus.ABSENT;
    if (hours < 7) return AttendanceStatus.HALF_DAY;
    return AttendanceStatus.PRESENT;
  }

  private effectiveStatus(record: { clockIn?: Date | null; clockOut?: Date | null; status: AttendanceStatus }) {
    if (record.clockIn && !record.clockOut) return AttendanceStatus.IN_PROGRESS;
    if (record.clockIn && record.clockOut) {
      const totalHours = (record.clockOut.getTime() - record.clockIn.getTime()) / 3600000;
      return this.classifyCompletedDuration(totalHours);
    }
    return record.status;
  }

  private effectiveRecord<T extends { clockIn?: Date | null; clockOut?: Date | null; status: AttendanceStatus }>(record: T): T {
    return { ...record, status: this.effectiveStatus(record) };
  }

  private async buildLeaveAwareStatusMap(
    employeeId: number,
    dates: Date[],
    attendanceByDate: Map<string, { clockIn?: Date | null; clockOut?: Date | null; status: AttendanceStatus }>,
  ) {
    if (!dates.length) return new Map<string, AttendanceStatus>();

    const workingDates = await this.workingDaysService.getWorkingDates(employeeId, dates);
    const workingDateKeys = new Set(workingDates.map((date) => getBusinessDateKey(date)));
    if (!workingDateKeys.size) return new Map<string, AttendanceStatus>();

    const dateWindowStart = new Date(Math.min(...dates.map((date) => date.getTime())));
    const dateWindowEnd = new Date(Math.max(...dates.map((date) => date.getTime())));
    const leaveRecords = this.prisma.leave
      ? await this.prisma.leave.findMany({
          where: {
            employeeId,
            status: { in: ['APPROVED', 'PENDING', 'REJECTED', 'CANCELLED'] },
            startDate: { lte: dateWindowEnd },
            endDate: { gte: dateWindowStart },
          },
          select: { status: true, startDate: true, endDate: true },
        })
      : [];

    const leaveStatusByDate = new Map<string, AttendanceStatus>();
    for (const leave of leaveRecords) {
      const normalizedStatus = leave.status ?? 'APPROVED';
      const leaveStart = new Date(leave.startDate.getFullYear(), leave.startDate.getMonth(), leave.startDate.getDate());
      const leaveEnd = new Date(leave.endDate.getFullYear(), leave.endDate.getMonth(), leave.endDate.getDate());
      for (let date = new Date(leaveStart); date <= leaveEnd; date.setDate(date.getDate() + 1)) {
        const key = getBusinessDateKey(date);
        if (!workingDateKeys.has(key)) continue;

        const nextStatus = normalizedStatus === 'APPROVED' ? AttendanceStatus.LEAVE : AttendanceStatus.ABSENT;
        const existingStatus = leaveStatusByDate.get(key);
        if (!existingStatus || (existingStatus !== AttendanceStatus.LEAVE && nextStatus === AttendanceStatus.LEAVE)) {
          leaveStatusByDate.set(key, nextStatus);
        }
      }
    }

    const statusByDate = new Map<string, AttendanceStatus>();
    for (const key of workingDateKeys) {
      const record = attendanceByDate.get(key);
      const leaveStatus = leaveStatusByDate.get(key);

      if (leaveStatus === AttendanceStatus.LEAVE) {
        statusByDate.set(key, AttendanceStatus.LEAVE);
        continue;
      }

      if (leaveStatus === AttendanceStatus.ABSENT) {
        statusByDate.set(key, AttendanceStatus.ABSENT);
        continue;
      }

      if (!record) {
        statusByDate.set(key, AttendanceStatus.ABSENT);
        continue;
      }

      statusByDate.set(key, this.effectiveStatus(record));
    }

    return statusByDate;
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

    const todayStart = this.attendanceDate();
    const todayEnd = new Date(getCurrentDayCutoff().getTime() - 1);
    const workingDate = todayStart;
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
    return await this.prisma.$transaction(async (tx) => {
      const result = await this.clockInWithClient(tx, employee.userId, employee.user.email);
      await tx.attendanceLog.create({
        data: { employeeId, type: 'IN', time: result.clockIn },
      });
      return { ...result, locationStatus };
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
    });
  }

  getAll() {
    return this.prisma.attendanceRecord.findMany({
      include: { user: { include: { employee: true } } },
      orderBy: { date: 'desc' },
    }).then((records) => records.map((record) => this.effectiveRecord(record)));
  }

  getUser(employeeId: number) {
    return this.prisma.attendanceRecord.findMany({
      where: { user: { employee: { id: employeeId } } },
      orderBy: { date: 'desc' },
    }).then((records) => records.map((record) => this.effectiveRecord(record)));
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

    const { start: monthStart, nextStart: nextMonthStart } = getMonthRange(year, monthIndex + 1);
    const today = new Date();
    const [todayYear, todayMonth] = getBusinessDateKey(today).split('-').map(Number);
    const isCurrentMonth = year === todayYear && monthIndex + 1 === todayMonth;
    const isFutureMonth = year > todayYear || (year === todayYear && monthIndex + 1 > todayMonth);

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
      ? new Date(getCurrentDayCutoff(today).getTime() - 1)
      : new Date(nextMonthStart.getTime() - 1);
    const dateKey = getBusinessDateKey;

    const calendarDates: Date[] = [];
    for (
      let date = new Date(monthStart);
      date <= calculationEndDate;
      date.setUTCDate(date.getUTCDate() + 1)
    ) {
      calendarDates.push(new Date(date));
    }

    const workingDateKeys = new Set(
      (await this.workingDaysService.getWorkingDates(employeeId, calendarDates)).map(dateKey),
    );

    const attendanceRecordsResult = await this.prisma.attendanceRecord.findMany({
      where: { userId: employee.userId },
    });
    const attendanceRecords = (attendanceRecordsResult ?? []).map((record) =>
      this.effectiveRecord(record),
    );

    const attendanceByDate = new Map(
      attendanceRecords
        .filter((record) => workingDateKeys.has(dateKey(record.clockIn)))
        .map((record) => [dateKey(record.clockIn), record]),
    );
    const statusByDate = await this.buildLeaveAwareStatusMap(employee.id, calendarDates, attendanceByDate);

    let presentDays = 0;
    let halfDays = 0;
    let leaveDays = 0;
    let absentDays = 0;

    for (const key of workingDateKeys) {
      const status = statusByDate.get(key) ?? AttendanceStatus.ABSENT;
      if (status === AttendanceStatus.PRESENT || status === AttendanceStatus.LATE) {
        presentDays += 1;
      } else if (status === AttendanceStatus.HALF_DAY) {
        halfDays += 1;
      } else if (status === AttendanceStatus.LEAVE) {
        leaveDays += 1;
      } else if (status === AttendanceStatus.ABSENT || status === AttendanceStatus.IN_PROGRESS) {
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
    }).then((records) => records.map((record) => this.effectiveRecord(record)));
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

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.getTodayStatus(employee.userId, employeeId);
  }
}
