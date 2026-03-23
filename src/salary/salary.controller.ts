import { Controller, Post, Body, UseGuards, Get, Param, Query } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';

@Controller('salary')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalaryController {
  constructor(private salaryService: SalaryService) {}

  @Post('assign')
  @Roles('HR', 'ADMIN')
  assignSalary(
    @Body()
    body: {
      employeeId?: number;
      empCode?: string;
      annualCTC: number;
      structureId: number;
    },
  ) {
    return this.salaryService.assignSalary(body);
  }

  @Get('employee/:id')
  @Roles('HR', 'ADMIN')
  getEmployeeSalaries(@Param('id') id: string) {
    return this.salaryService.getEmployeeSalaries(Number(id));
  }

  @Get('employee/code/:empCode')
  @Roles('HR', 'ADMIN')
  getEmployeeSalariesByCode(@Param('empCode') empCode: string) {
    return this.salaryService.getEmployeeSalaries(undefined, empCode);
  }

  @Get('all')
  @Roles('HR', 'ADMIN')
  getAllSalaries() {
    return this.salaryService.getAllSalaries();
  }
}
