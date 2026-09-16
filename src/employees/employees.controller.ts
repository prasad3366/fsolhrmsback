import {
  Controller,
  Get,
  Req,
  UseGuards,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseIntPipe,
  Inject,
  forwardRef,
} from '@nestjs/common';

import { EmployeesService } from './employees.service';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
} from './dto/create-employee.dto';

import { Roles } from '../common/decorators/roles.decorators';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeSelfOrAdminGuard } from '../common/guards/employee-self-or-admin.guard';
import { EmployeeDirectoryQueryDto } from './dto/employee-directory-query.dto';
import { AssetsService } from '../assets/assets.service';
import { DocumentsService } from '../documents/documents.service';
import { PayrollService } from '../payroll/payroll.service';
import { AttendanceService } from '../attendance/attendance.service';
import { LeaveService } from '../leave/leave.service';

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly assetsService: AssetsService,
    private readonly documentsService: DocumentsService,
    @Inject(forwardRef(() => PayrollService))
    private readonly payrollService: PayrollService,
    @Inject(forwardRef(() => AttendanceService))
    private readonly attendanceService: AttendanceService,
    private readonly leaveService: LeaveService,
  ) {}

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
  @Roles(
    'SUPER_ADMIN',
    'CEO',
    'HR',
    'FINANCE_MANAGER',
    'IT_MANAGER',
    'SALES_MANAGER',
    'EMPLOYEE',
  )
  getAllEmployees(@Req() req, @Query() query: EmployeeDirectoryQueryDto) {
    return this.employeesService.getAllEmployees(req.user, query);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  createEmployee(@Body() dto: CreateEmployeeDto, @Req() req) {
    return this.employeesService.createEmployee(dto, req.user.role);
  }

  @Get(':id/360')
  @UseGuards(EmployeeSelfOrAdminGuard)
  @Roles(
    'SUPER_ADMIN',
    'CEO',
    'HR',
    'FINANCE_MANAGER',
    'IT_MANAGER',
    'SALES_MANAGER',
    'EMPLOYEE',
  )
  getEmployee360(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    return this.employeesService.getEmployee360Profile(id, req.user.role);
  }

  @Get(':id/360/hierarchy')
  @UseGuards(EmployeeSelfOrAdminGuard)
  @Roles(
    'SUPER_ADMIN',
    'CEO',
    'HR',
    'IT_MANAGER',
    'SALES_MANAGER',
    'EMPLOYEE',
  )
  getEmployee360Hierarchy(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    return this.employeesService.getEmployee360Hierarchy(req.user, id);
  }

  @Get(':id/360/assets')
  @UseGuards(EmployeeSelfOrAdminGuard)
  @Roles(
    'SUPER_ADMIN',
    'CEO',
    'HR',
    'IT_MANAGER',
    'SALES_MANAGER',
    'EMPLOYEE',
  )
  getEmployee360Assets(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    return this.assetsService.findEmployee360Assets(req.user, id);
  }

  @Get(':id/360/documents')
  @UseGuards(EmployeeSelfOrAdminGuard)
  @Roles(
    'SUPER_ADMIN',
    'CEO',
    'HR',
    'IT_MANAGER',
    'SALES_MANAGER',
    'EMPLOYEE',
  )
  getEmployee360Documents(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    return this.documentsService.getEmployee360DocumentMetadata(req.user, id);
  }

  @Get(':id/360/payroll')
  @UseGuards(EmployeeSelfOrAdminGuard)
  @Roles(
    'SUPER_ADMIN',
    'CEO',
    'HR',
    'FINANCE_MANAGER',
    'IT_MANAGER',
    'SALES_MANAGER',
    'EMPLOYEE',
  )
  getEmployee360Payroll(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    return this.payrollService.getEmployee360PayrollSummary(req.user, id);
  }

  @Get(':id/360/attendance')
  @UseGuards(EmployeeSelfOrAdminGuard)
  @Roles(
    'SUPER_ADMIN',
    'CEO',
    'HR',
    'FINANCE_MANAGER',
    'IT_MANAGER',
    'SALES_MANAGER',
    'EMPLOYEE',
  )
  getEmployee360Attendance(
    @Param('id', ParseIntPipe) id: number,
    @Query('month') month: string,
    @Req() req,
  ) {
    return this.attendanceService.getTargetEmployeeAttendanceSummary(
      req.user,
      id,
      month,
    );
  }

  @Get(':id/360/leave')
  @UseGuards(EmployeeSelfOrAdminGuard)
  @Roles(
    'SUPER_ADMIN',
    'CEO',
    'HR',
    'FINANCE_MANAGER',
    'IT_MANAGER',
    'SALES_MANAGER',
    'EMPLOYEE',
  )
  getEmployee360Leave(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    return this.leaveService.getTargetEmployeeLeaveSummary(req.user, id);
  }

  @Get(':id')
  @UseGuards(EmployeeSelfOrAdminGuard)
  @Roles(
    'SUPER_ADMIN',
    'CEO',
    'HR',
    'FINANCE_MANAGER',
    'IT_MANAGER',
    'SALES_MANAGER',
    'EMPLOYEE',
  )
  getEmployeeDetails(@Param('id') id: string) {
    return this.employeesService.getEmployeeDetailsById(Number(id));
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  updateEmployee(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.updateEmployee(Number(id), dto);
  }
}
