import {
  BadRequestException,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Body,
  Param,
  Query,
  UseGuards,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { LeaveService } from './leave.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { RejectLeaveDto } from './dto/reject-leave.dto';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('leaves')
@UseGuards(JwtAuthGuard)
export class LeaveController {
  private readonly authorizationService: AuthorizationService;

  constructor(
    private readonly service: LeaveService,
    private readonly prisma: PrismaService,
  ) {
    this.authorizationService = new AuthorizationService(this.prisma);
  }

  private getAuthenticatedEmployeeId(req: any): number {
    const employeeId = Number(req?.user?.employeeId);

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new UnauthorizedException('Employee profile required');
    }

    return employeeId;
  }

  private assertOrgWideAccess(req: any): void {
    if (!this.authorizationService.canAccessOrganizationWide(req.user, 'leave')) {
      throw new ForbiddenException('Access denied');
    }
  }

  private async assertLeaveManagementAccess(req: any): Promise<void> {
    const role = String(req?.user?.role ?? '').toUpperCase();

    if (this.authorizationService.canAccessOrganizationWide(req.user, 'leave')) {
      return;
    }

    if (
      (role === 'IT_MANAGER' || role === 'SALES_MANAGER') &&
      Number.isInteger(Number(req?.user?.employeeId)) &&
      Number(req.user.employeeId) > 0
    ) {
      return;
    }

    throw new ForbiddenException('Access denied');
  }

  @Post('apply')
  async apply(@Req() req, @Body() dto: CreateLeaveDto) {
    const employeeId = this.getAuthenticatedEmployeeId(req);

    if (!(await this.authorizationService.canAccessEmployee(req.user, employeeId))) {
      throw new ForbiddenException('Access denied');
    }

    return this.service.applyLeave(employeeId, dto);
  }

  @Patch('approve/:id')
  async approve(@Req() req, @Param('id') id: string) {
    await this.assertLeaveManagementAccess(req);
    return this.service.approveLeave(+id, req.user.employeeId, req.user.role);
  }

  @Patch('reject/:id')
  reject(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: RejectLeaveDto,
  ) {
    return this.assertLeaveManagementAccess(req).then(() =>
      this.service.rejectLeave(+id, dto.remarks, req.user.employeeId, req.user.role),
    );
  }

  @Get('history')
  async history(@Req() req, @Query('page') page?: string, @Query('limit') limit?: string) {
    const role = String(req?.user?.role ?? '').toUpperCase();

    if (role === 'EMPLOYEE') {
      const employeeId = this.getAuthenticatedEmployeeId(req);
      return this.service.leaveHistory(req.user.role, employeeId, Number(page ?? 1), Number(limit ?? 10));
    }

    await this.assertLeaveManagementAccess(req);

    const parsedPage = page === undefined ? 1 : Number(page);
    const parsedLimit = limit === undefined ? 10 : Number(limit);

    if (
      !Number.isInteger(parsedPage) ||
      parsedPage < 1 ||
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1
    ) {
      throw new BadRequestException('page and limit must be positive integers');
    }

    return this.service.leaveHistory(
      req.user.role,
      req.user.employeeId,
      parsedPage,
      parsedLimit,
      req.user,
    );
  }

  @Get('pending')
  async pending(@Req() req) {
    await this.assertLeaveManagementAccess(req);
    return this.service.pendingRequests(req.user.role, req.user);
  }

  @Get('all')
  async all(@Req() req) {
    await this.assertLeaveManagementAccess(req);
    return this.service.allLeaveRequests(req.user.role, req.user);
  }

  @Get('balance')
  balance(@Req() req, @Query('yearStart') yearStart: string) {
    const role = String(req?.user?.role ?? '').toUpperCase();

    if (role === 'EMPLOYEE') {
      return this.service.getBalance(req.user.role, this.getAuthenticatedEmployeeId(req), +yearStart);
    }

    this.assertOrgWideAccess(req);
    return this.service.getBalance(req.user.role, req.user.employeeId, +yearStart);
  }

  @Get('self/history')
  async selfHistory(@Req() req) {
    const employeeId = this.getAuthenticatedEmployeeId(req);

    if (!(await this.authorizationService.canAccessEmployee(req.user, employeeId))) {
      throw new ForbiddenException('Access denied');
    }

    return this.service.selfLeaveHistory(employeeId);
  }

  @Get('self/balance')
  async selfBalance(@Req() req, @Query('yearStart') yearStart: string) {
    const employeeId = this.getAuthenticatedEmployeeId(req);

    if (!(await this.authorizationService.canAccessEmployee(req.user, employeeId))) {
      throw new ForbiddenException('Access denied');
    }

    return this.service.selfBalance(employeeId, +yearStart);
  }

  @Post('carry-forward')
  async carryForward(@Req() req, @Body() dto: { leaveTypeId: number; yearStart: number }) {
    const employeeId = this.getAuthenticatedEmployeeId(req);

    if (!(await this.authorizationService.canAccessEmployee(req.user, employeeId))) {
      throw new ForbiddenException('Access denied');
    }

    return this.service.requestCarryForward(employeeId, dto.leaveTypeId, dto.yearStart);
  }
}
