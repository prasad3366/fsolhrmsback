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
} from '@nestjs/common';

import { PayrollService } from './payroll.service';
import { RunPayrollDto } from './dto/run-payroll.dto';
import { PayslipService } from './payslip.service';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';

import type { Response, Request } from 'express';

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(
    private payrollService: PayrollService,
    private payslipService: PayslipService,
  ) {}

  /* Generate payroll manually */

  @Post('run')
  @Roles('ADMIN', 'HR', 'MANAGER')
  runPayroll(@Body() dto: RunPayrollDto) {
    return this.payrollService.runPayroll(dto);
  }

  /* Manual "Generate Payslip" action for HR/Admin/Manager -
     runs payroll for the period if it hasn't been run yet, then
     returns the payslip PDF directly. */

  @Post('generate-payslip')
  @Roles('ADMIN', 'HR', 'MANAGER')
  async generatePayslipManually(
    @Body() dto: RunPayrollDto,
    @Res() res: Response,
  ) {
    const payroll = await this.payrollService.generateOrGetPayroll(dto);
    return this.payslipService.generatePayslip(payroll.id, res);
  }

  /* Add allowance or deduction */

  @Post('others')
  @Roles('ADMIN', 'HR', 'MANAGER')
  addOther(
    @Body()
    body: {
      payrollId: number;
      name: string;
      type: 'ALLOWANCE' | 'DEDUCTION';
      amount: number;
    },
  ) {
    if (!body.payrollId || !body.name || !body.amount) {
      throw new BadRequestException('Invalid adjustment data');
    }

    return this.payrollService.addOther(
      body.payrollId,
      body.name,
      body.type,
      body.amount,
    );
  }

  /* Get payroll for specific employee */

  @Get()
  @Roles('ADMIN', 'HR', 'MANAGER')
  getPayroll(@Query('employeeId') employeeId: number) {
    if (!employeeId) {
      throw new BadRequestException('employeeId is required');
    }

    return this.payrollService.getPayroll(Number(employeeId));
  }

  /* Download payslip - HR/Admin/Manager can download anyone's, an employee only their own */

  @Get('payslip/:id')
  async downloadPayslip(
    @Param('id') id: number,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    if (!id) {
      throw new BadRequestException('Invalid payroll id');
    }

    const user = req.user as any;
    const canViewAny = ['ADMIN', 'HR', 'MANAGER'].includes(user?.role);

    if (!canViewAny) {
      const payroll = await this.payrollService.getPayrollById(Number(id));
      if (!payroll || payroll.employeeId !== user?.employeeId) {
        throw new BadRequestException('Payslip not found');
      }
    }

    return this.payslipService.generatePayslip(Number(id), res);
  }

  /* Logged in employee payroll */

  @Get('my')
  async getMyPayroll(@Req() req: Request) {
    const user = req.user as any;

    if (!user || !user.employeeId) {
      throw new BadRequestException('User does not have an employee profile');
    }

    return this.payrollService.getPayroll(user.employeeId);
  }
}
