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

  private parsePayrollId(id: unknown): number {
    const payrollId = Number(id);
    if (!Number.isInteger(payrollId) || payrollId <= 0) {
      throw new BadRequestException('Invalid payroll id');
    }
    return payrollId;
  }

  @Post(':id/recalculate')
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  recalculatePayroll(@Param('id') id: number, @Req() req?: Request) {
    return this.payrollService.recalculatePayroll(this.parsePayrollId(id), req?.user as any);
  }

  /* Read-only: what recalculation would change, without writing */

  @Get(':id/recalculate-preview')
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  previewRecalculation(@Param('id') id: number) {
    return this.payrollService.previewRecalculation(this.parsePayrollId(id));
  }

  /* Correction workflow: reopen a finalized payroll (reason required) */

  @Post(':id/reopen')
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  reopenPayroll(
    @Param('id') id: number,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ) {
    return this.payrollService.reopenPayroll(
      this.parsePayrollId(id),
      String(body?.reason ?? ''),
      req.user as any,
    );
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

  @Post(':id/finalize')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  finalizePayroll(@Param('id') id: number, @Req() req?: Request) {
    return this.payrollService.finalizePayroll(Number(id), req?.user as any);
  }

  /* Get payroll for specific employee */

  @Get()
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER')
  getPayroll(@Query('employeeId') employeeId: string | undefined, @Req() req: Request) {
    if (employeeId === undefined) {
      const role = String((req.user as any)?.role ?? '').toUpperCase();
      if (!['SUPER_ADMIN', 'CEO', 'HR'].includes(role)) {
        throw new ForbiddenException('Access denied');
      }
      return this.payrollService.getPayroll();
    }

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
    const payrollId = this.parsePayrollId(id);

    const user = this.requireAuthenticatedEmployee(req);
    const role = String(user.role).toUpperCase();
    const isOrgWideRole = [
      'SUPER_ADMIN',
      'CEO',
      'HR',
      'FINANCE_MANAGER',
    ].includes(role);

    if (isOrgWideRole) {
      return this.payslipService.generatePayslip(payrollId, res);
    }

    const payroll = await this.payrollService.getPayrollById(payrollId);
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

    return this.payslipService.generatePayslip(payrollId, res);
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

    // Employees see only finalized/paid payroll; DRAFT figures are not final
    return this.payrollService.getPayroll(employeeId, {
      finalizedOnly: String(user.role).toUpperCase() === 'EMPLOYEE',
    });
  }
}
