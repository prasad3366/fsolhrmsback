import {
  Controller,
  Get,
  Req,
  UseGuards,
  Post,
  Body,
} from '@nestjs/common';

import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';

import { Roles } from '../common/decorators/roles.decorators';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

 @Post()
@Roles('ADMIN', 'HR')
createEmployee(@Body() dto: CreateEmployeeDto, @Req() req) {
  return this.employeesService.createEmployee(dto, req.user.role);
}

  @Get()
  @Roles('ADMIN', 'HR', 'MANAGER')
  getAllEmployees() {
    return this.employeesService.getAllEmployees();
  }

  @Get('me')
  getMyDetails(@Req() req) {
    return this.employeesService.getMyDetails(req.user.id);
  }
}









