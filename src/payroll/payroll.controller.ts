import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  Param,
  Res,
  UseGuards,
  BadRequestException,
  Req,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { PayrollService } from './payroll.service';
import { RunPayrollDto } from './dto/run-payroll.dto';
import { PayslipService } from './payslip.service';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { AuthorizationService } from '../common/authorization/authorization.service';

import type { Response, Request } from 'express';

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(
    private payrollService: PayrollService,
    private payslipService: PayslipService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  private requireAuthenticatedEmployee(req: Request): any {
    const user = req.user as any;

    if (!user || !user.role || !user.employeeId) {
      throw new UnauthorizedException('Employee profile required');
    }

    return user;
  }

  /* Generate payroll manually */

  @Post('run')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  runPayroll(@Body() dto: RunPayrollDto) {
    return this.payrollService.runPayroll(dto);
  }

  /* Manual "Generate Payslip" action for org-wide finance/HR roles -
     runs payroll for the period if it hasn't been run yet, then
     returns the payslip PDF directly. */

  @Post('generate-payslip')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  async generatePayslipManually(
    @Body() dto: RunPayrollDto,
    @Res() res: Response,
  ) {
    const payroll = await this.payrollService.generateOrGetPayroll(dto);
    return this.payslipService.generatePayslip(payroll.id, res);
  }

  /* Add allowance or deduction */

  @Post('others')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  addOther(
    @Body()
    body: {
      payrollId: number;
      name: string;
      type: 'ALLOWANCE' | 'DEDUCTION';
      amount: number;
    },
  ) {
    const payrollId = Number(body.payrollId);
    const amount = Number(body.amount);

    if (!Number.isInteger(payrollId) || payrollId <= 0) {
      throw new BadRequestException('Invalid payrollId');
    }

    if (!body.name || !String(body.name).trim()) {
      throw new BadRequestException('Invalid adjustment data');
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Adjustment amount must be a positive number');
    }

    return this.payrollService.addOther(
      payrollId,
      body.name,
      body.type,
      amount,
    );
  }

  /* Get payroll for specific employee */

  @Get()
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  getPayroll(@Query('employeeId') employeeId: number) {
    const parsedEmployeeId = Number(employeeId);

    if (!Number.isInteger(parsedEmployeeId) || parsedEmployeeId <= 0) {
      throw new BadRequestException('employeeId is required and must be a positive integer');
    }

    return this.payrollService.getPayroll(parsedEmployeeId);
  }

  @Get('unassigned-employees')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  getEmployeesWithoutSalary() {
    return this.payrollService.getEmployeesWithoutSalary();
  }

  /* Payslips are available to org-wide payroll roles, while employees may only access their own */

  @Get('payslip/:id')
  async downloadPayslip(
    @Param('id') id: number,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    if (!id) {
      throw new BadRequestException('Invalid payroll id');
    }

    const user = this.requireAuthenticatedEmployee(req);
    const role = String(user.role).toUpperCase();
    const isOrgWideRole = [
      'SUPER_ADMIN',
      'CEO',
      'HR',
      'FINANCE_MANAGER',
    ].includes(role);

    if (isOrgWideRole) {
      return this.payslipService.generatePayslip(Number(id), res);
    }

    const payroll = await this.payrollService.getPayrollById(Number(id));
    if (!payroll) {
      throw new BadRequestException('Payslip not found');
    }

    const hasAccess = await this.authorizationService.canAccessEmployee(
      user,
      payroll.employeeId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('Access denied');
    }

    return this.payslipService.generatePayslip(Number(id), res);
  }

  /* Logged in employee payroll */

  @Get('my')
  async getMyPayroll(@Req() req: Request) {
    const user = this.requireAuthenticatedEmployee(req);
    const employeeId = Number(user.employeeId);

    const hasAccess = await this.authorizationService.canAccessEmployee(
      user,
      employeeId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('Access denied');
    }

    return this.payrollService.getPayroll(employeeId);
  }
}
