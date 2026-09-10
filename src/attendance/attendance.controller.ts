import {
  Controller,
  Post,
  Body,
  Req,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';

import { AttendanceService } from './attendance.service';
import { PunchDto } from './dto/punch.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OfficeLocationDto } from './dto/office-location.dto';
import {
  AttendanceHistoryQueryDto,
  ProcessRegularizationDto,
  RegularizationDto,
} from './dto/attendance-record.dto';

import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { AuthorizationService } from '../common/authorization/authorization.service';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(
    private readonly service: AttendanceService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Post('clock-in')
  clockIn(@Req() req: any) {
    return this.service.clockIn(req.user.id, req.user.email, req.ip);
  }

  @Post('clock-out')
  clockOut(@Req() req: any, @Body('date') date?: string) {
    return this.service.clockOut(req.user.id, date ? new Date(date) : new Date());
  }

  @Get('today')
  async getToday(@Req() req: any) {
    return this.service.getTodayStatusForEmployee(this.requireSelfEmployeeId(req));
  }

  private requireSelfEmployeeId(req: any): number {
    const employeeId = Number(req?.user?.employeeId);

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new UnauthorizedException('Employee profile required');
    }

    return employeeId;
  }

  private ensureOrgWideAccess(req: any) {
    if (!this.authorizationService.canAccessOrganizationWide(req.user, 'attendance')) {
      throw new ForbiddenException('Access denied');
    }
  }

  private async ensureEmployeeAttendanceAccess(req: any, employeeId: number) {
    if (this.authorizationService.canAccessOrganizationWide(req.user, 'attendance')) {
      return;
    }

    if (!(await this.authorizationService.canAccessEmployee(req.user, employeeId))) {
      throw new ForbiddenException('Access denied');
    }
  }

  // ============================
  // EMPLOYEE PUNCH IN
  // ============================
  @Post('punch-in')
  async punchIn(@Req() req, @Body() dto: PunchDto) {
    const employeeId = this.requireSelfEmployeeId(req);

    const lat = dto.latitude;
    const lng = dto.longitude;

    if (lat == null || lng == null) {
      throw new BadRequestException('Latitude & Longitude required');
    }

    return this.service.punchIn(employeeId, lat, lng);
  }

  // ============================
  // EMPLOYEE PUNCH OUT
  // ============================
  @Post('punch-out')
  async punchOut(@Req() req, @Body() dto: PunchDto) {
    const employeeId = this.requireSelfEmployeeId(req);

    const lat = dto.latitude;
    const lng = dto.longitude;

    if (lat == null || lng == null) {
      throw new BadRequestException('Latitude & Longitude required');
    }

    return this.service.punchOut(employeeId, lat, lng);
  }

  // ============================
  // SUPER_ADMIN / CEO / HR
  // VIEW ALL ATTENDANCE
  // ============================
  @Get('all')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  getAll(@Req() req) {
    this.ensureOrgWideAccess(req);
    return this.service.getAll();
  }

  @Get('employees')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'SALES_MANAGER', 'IT_MANAGER', 'EMPLOYEE')
  getAttendanceEmployees(@Req() req, @Query('search') search?: string) {
    return this.service.getAttendanceEmployees(req, search);
  }

  // ============================
  // SUPER_ADMIN / CEO / HR
  // VIEW EMPLOYEE ATTENDANCE
  // ============================
  @Get('employee/:id/summary')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER', 'EMPLOYEE')
  async getEmployeeSummary(@Req() req, @Param('id') id: string, @Query('month') month: string) {
    const employeeId = Number(id);
    await this.ensureEmployeeAttendanceAccess(req, employeeId);
    return this.service.getEmployeeMonthlySummary(employeeId, month);
  }

  @Get('employee/:id/monthly')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER', 'EMPLOYEE')
  async getEmployeeMonthlyAttendance(
    @Req() req,
    @Param('id') id: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('status') status?: string,
  ) {
    const employeeId = Number(id);
    await this.ensureEmployeeAttendanceAccess(req, employeeId);

    if (month === undefined || year === undefined) {
      throw new BadRequestException('Month and year must be provided together');
    }

    const monthNumber = Number(month);
    const yearNumber = Number(year);
    if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      throw new BadRequestException('Month must be between 1 and 12');
    }
    if (!Number.isInteger(yearNumber) || yearNumber < 1) {
      throw new BadRequestException('Year must be a valid positive integer');
    }

    return this.service.getMyAttendanceForEmployee(
      employeeId,
      monthNumber,
      yearNumber,
      status as AttendanceStatus | undefined,
    );
  }

  @Get('employee/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  getUser(@Req() req, @Param('id') id: string) {
    this.ensureOrgWideAccess(req);
    return this.service.getUser(Number(id));
  }

  // ============================
  // SUPER_ADMIN / CEO / HR
  // SET OFFICE LOCATION
  // ============================
  @Post('location')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  setOfficeLocation(@Req() req, @Body() dto: OfficeLocationDto) {
    this.ensureOrgWideAccess(req);
    return this.service.setOfficeLocation(dto);
  }

  // ============================
  // EMPLOYEE SELF ATTENDANCE
  // ============================
  @Get('my-history')
  async getMyAttendance(@Req() req, @Query() query: AttendanceHistoryQueryDto) {
    const selfEmployeeId = this.requireSelfEmployeeId(req);
    const page = query.page === undefined ? undefined : Number(query.page);
    const pageSize = query.pageSize === undefined ? undefined : Number(query.pageSize);

    if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
      throw new BadRequestException('Page must be a positive integer');
    }

    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10000)) {
      throw new BadRequestException('Page size must be between 1 and 10000');
    }

    const hasMonth = query.month !== undefined && query.month !== null;
    const hasYear = query.year !== undefined && query.year !== null;

    if (hasMonth !== hasYear) {
      throw new BadRequestException('Month and year must be provided together');
    }

    if (hasMonth && hasYear) {
      const month = Number(query.month);
      const year = Number(query.year);
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new BadRequestException('Month must be between 1 and 12');
      }
      if (!Number.isInteger(year) || year < 1) {
        throw new BadRequestException('Year must be a valid positive integer');
      }
      return this.service.getMyAttendanceForEmployee(
        selfEmployeeId,
        month,
        year,
        query.status,
        page,
        pageSize,
      );
    }

    return this.service.getMyAttendanceForEmployee(
      selfEmployeeId,
      query.month,
      query.year,
      query.status,
      page,
      pageSize,
    );
  }

  @Post('regularize')
  requestRegularization(@Req() req: any, @Body() dto: RegularizationDto) {
    return this.service.requestRegularization(dto, req.user.id, req.user.email);
  }

  @Get('regularizations')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'MANAGER')
  getRegularizations() {
    return this.service.getRegularizations();
  }

  @Patch('regularizations/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'MANAGER')
  processRegularization(
    @Param('id') id: string,
    @Body() dto: ProcessRegularizationDto,
    @Req() req: any,
  ) {
    return this.service.processRegularization(
      Number(id),
      dto.status,
      req.user.email,
      dto.rejectionReason,
    );
  }

  // ============================
  // EMPLOYEE TODAY STATUS (for punch buttons)
  // ============================
  @Get('today-status')
  async getTodayStatus(@Req() req) {
    const employeeId = this.requireSelfEmployeeId(req);
    return this.service.getTodayAttendance(employeeId);
  }
}
