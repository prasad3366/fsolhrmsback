import {
  Controller,
  Get,
  Req,
  UseGuards,
  Post,
  Patch,
  Param,
  Body,
} from '@nestjs/common';

import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';

import { Roles } from '../common/decorators/roles.decorators';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeSelfOrAdminGuard } from '../common/guards/employee-self-or-admin.guard';

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // ✅ Specific routes BEFORE generic parameter routes
  @Get('me')
  getMyDetails(@Req() req) {
    return this.employeesService.getMyDetails(req.user.id);
  }

  @Get('info/id')
  getEmployeeId(@Req() req) {
    return this.employeesService.getEmployeeIdByUserId(req.user.id);
  }

  @Get()
  @Roles('ADMIN', 'HR', 'MANAGER')
  getAllEmployees() {
    return this.employeesService.getAllEmployees();
  }

  @Post()
  @Roles('ADMIN', 'HR')
  createEmployee(@Body() dto: CreateEmployeeDto, @Req() req) {
    return this.employeesService.createEmployee(dto, req.user.role);
  }

  @Get(':id')
  @UseGuards(EmployeeSelfOrAdminGuard)
  @Roles('ADMIN', 'HR', 'MANAGER', 'EMPLOYEE')
  getEmployeeDetails(@Param('id') id: string) {
    return this.employeesService.getEmployeeDetailsById(Number(id));
  }

  @Patch(':id')
  @Roles('ADMIN', 'HR')
  updateEmployee(
    @Param('id') id: string,
    @Body() dto: Partial<CreateEmployeeDto>,
  ) {
    return this.employeesService.updateEmployee(Number(id), dto);
  }
}
