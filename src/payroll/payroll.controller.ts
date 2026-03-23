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

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import type { Response, Request } from 'express';

@Controller('payroll')
export class PayrollController {
  constructor(
    private payrollService: PayrollService,
    private payslipService: PayslipService,
  ) {}

  /* Generate payroll manually */

  @Post('run')
  runPayroll(@Body() dto: RunPayrollDto) {
    return this.payrollService.runPayroll(dto);
  }

  /* Add allowance or deduction */

  @Post('others')
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
  getPayroll(@Query('employeeId') employeeId: number) {
    if (!employeeId) {
      throw new BadRequestException('employeeId is required');
    }

    return this.payrollService.getPayroll(Number(employeeId));
  }

  /* Download payslip */

  @Get('payslip/:id')
  downloadPayslip(@Param('id') id: number, @Res() res: Response) {
    if (!id) {
      throw new BadRequestException('Invalid payroll id');
    }

    return this.payslipService.generatePayslip(Number(id), res);
  }

  /* Logged in employee payroll */

  @Get('my')
  @UseGuards(JwtAuthGuard)
  async getMyPayroll(@Req() req: Request) {
    const user = req.user as any;

    if (!user || !user.employeeId) {
      throw new BadRequestException('User does not have an employee profile');
    }

    return this.payrollService.getPayroll(user.employeeId);
  }
}
