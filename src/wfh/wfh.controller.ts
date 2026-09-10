import {
  Controller,
  Post,
  Body,
  Req,
  Param,
  UseGuards,
  Get,
  Patch,
  UnauthorizedException,
  ForbiddenException,
  ArgumentMetadata,
  BadRequestException,
  PipeTransform,
} from '@nestjs/common';
import { WfhService } from './wfh.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { RequestWfhDto } from './dto/wfh-request.dto';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';

export class PositiveIntPipe implements PipeTransform<string, number> {
  transform(value: string, _metadata: ArgumentMetadata): number {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(
        'Validation failed (positive integer is expected)',
      );
    }

    const parsedValue = Number(value);
    if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
      throw new BadRequestException(
        'Validation failed (positive integer is expected)',
      );
    }

    return parsedValue;
  }
}

@Controller('wfh')
@UseGuards(JwtAuthGuard)
export class WfhController {
  private readonly authorizationService: AuthorizationService;

  constructor(
    private readonly service: WfhService,
    private readonly prisma: PrismaService,
    authorizationService: AuthorizationService,
  ) {
    this.authorizationService = authorizationService;
  }

  private requireEmployeeId(req: any): number {
    const employeeId = Number(req?.user?.employeeId);

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new UnauthorizedException('Employee profile required');
    }

    return employeeId;
  }

  // Employee Request WFH
  @Post('request')
  async request(@Req() req, @Body() dto: RequestWfhDto) {
    const employeeId = this.requireEmployeeId(req);

    if (!(await this.authorizationService.canAccessEmployee(req.user, employeeId))) {
      throw new ForbiddenException('Access denied');
    }

    const request = await this.service.request(employeeId, dto);
    return { success: true, request };
  }

  // WFH management roles -> Approve WFH
  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER')
  async approve(@Req() req, @Param('id', PositiveIntPipe) requestId: number) {
    if (!(await this.authorizationService.canManageWfhRequest(req.user, requestId))) {
      throw new ForbiddenException('Access denied');
    }

    return this.service.approve(requestId);
  }

  // WFH management roles -> Reject WFH
  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER')
  async reject(@Req() req, @Param('id', PositiveIntPipe) requestId: number) {
    if (!(await this.authorizationService.canManageWfhRequest(req.user, requestId))) {
      throw new ForbiddenException('Access denied');
    }

    return this.service.reject(requestId);
  }

  // WFH management roles -> View all permitted requests
  @Get('all')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER')
  async getAll(@Req() req) {
    if (!this.authorizationService.canManageWfh(req.user)) {
      throw new ForbiddenException('Access denied');
    }

    if (this.authorizationService.canManageWfhOrganizationWide(req.user)) {
      return this.service.getAll();
    }

    const teamIds = await this.authorizationService.getWfhManagedTeamIds(req.user);
    return this.service.getAll(teamIds);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER')
  async updateStatus(
    @Req() req,
    @Param('id', PositiveIntPipe) requestId: number,
    @Body('status') status: string,
  ) {
    if (!(await this.authorizationService.canManageWfhRequest(req.user, requestId))) {
      throw new ForbiddenException('Access denied');
    }

    if (status !== 'APPROVED' && status !== 'REJECTED') {
      throw new BadRequestException('Status must be APPROVED or REJECTED');
    }

    return status === 'APPROVED'
      ? this.service.approve(requestId)
      : this.service.reject(requestId);
  }

  // Employee View Own Requests
  @Get('my')
  async getMine(@Req() req) {
    const employeeId = this.requireEmployeeId(req);

    if (!(await this.authorizationService.canAccessEmployee(req.user, employeeId))) {
      throw new ForbiddenException('Access denied');
    }

    return this.service.getMyRequests(employeeId);
  }
}
