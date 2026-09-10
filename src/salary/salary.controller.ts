import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  Req,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('salary')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalaryController {
  private readonly authorizationService: AuthorizationService;

  constructor(
    private salaryService: SalaryService,
    private readonly prisma: PrismaService,
  ) {
    this.authorizationService = new AuthorizationService(this.prisma);
  }

  private requireUser(req: any) {
    const user = req?.user;

    if (!user || !user.role) {
      throw new UnauthorizedException('Authentication required');
    }

    return user;
  }

  private hasOrgWideSalaryAccess(user: any): boolean {
    return this.authorizationService.canAccessOrganizationWide(user, 'salary');
  }

  private async assertEmployeeSalaryAccess(
    req: any,
    targetEmployeeId: number | string,
  ): Promise<void> {
    const user = this.requireUser(req);

    if (this.hasOrgWideSalaryAccess(user)) {
      return;
    }

    const hasAccess = await this.authorizationService.canAccessEmployee(
      user,
      targetEmployeeId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('Access denied');
    }
  }

  @Post('assign')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  assignSalary(
    @Body()
    body: {
      employeeId?: number | string;
      employee?: number | string;
      empCode?: string;
      annualCTC?: number | string;
      annualCtc?: number | string;
      ctc?: number | string;
      structureId?: number | string;
      salaryStructureId?: number | string;
    },
    @Req() req: any,
  ) {
    this.requireUser(req);
    return this.salaryService.assignSalary({
      ...body,
      ...(body.employeeId !== undefined && {
        employeeId: Number(body.employeeId),
      }),
    });
  }

  @Get('unassigned-employees')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  getEmployeesWithoutSalary(@Req() req: any) {
    this.requireUser(req);
    return this.salaryService.getEmployeesWithoutSalary();
  }

  @Get('structures')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  getSalaryStructures(@Req() req: any) {
    this.requireUser(req);
    return this.salaryService.getSalaryStructures();
  }

  @Get('employee/:employeeId')
  async getEmployeeSalaries(
    @Param('employeeId') employeeId: string,
    @Req() req: any,
  ) {
    const targetEmployeeId = Number(employeeId);

    if (!Number.isInteger(targetEmployeeId) || targetEmployeeId <= 0) {
      throw new BadRequestException('Invalid employee id');
    }

    await this.assertEmployeeSalaryAccess(req, targetEmployeeId);
    return this.salaryService.getLatestEmployeeSalary(targetEmployeeId);
  }

  @Get('employee/code/:empCode')
  async getEmployeeSalariesByCode(
    @Param('empCode') empCode: string,
    @Req() req: any,
  ) {
    const user = this.requireUser(req);

    if (!empCode || !empCode.trim()) {
      throw new BadRequestException('Employee code is required');
    }

    const records = await this.salaryService.getEmployeeSalaries(undefined, empCode);

    if (!records || records.length === 0) {
      throw new BadRequestException('Salary record not found');
    }

    const targetEmployeeId = records[0]?.employee?.id ?? records[0]?.employeeId;

    if (!targetEmployeeId) {
      throw new BadRequestException('Salary record not found');
    }

    if (this.hasOrgWideSalaryAccess(user)) {
      return records;
    }

    const hasAccess = await this.authorizationService.canAccessEmployee(
      user,
      targetEmployeeId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('Access denied');
    }

    return records;
  }

  @Get('all')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  getAllSalaries(@Req() req: any) {
    this.requireUser(req);
    return this.salaryService.getAllSalaries();
  }
}
