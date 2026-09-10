import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorators';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { SettingsService } from './settings.service';
import { AttendancePolicyService } from './services/attendance-policy.service';
import { LeavePolicyService } from './services/leave-policy.service';
import { HolidayService } from './services/holiday.service';
import { SecurityPolicyService } from './services/security-policy.service';
import { WorkflowPolicyService } from './services/workflow-policy.service';
import {
  CreateHolidayPolicyDto,
  UpdateAttendancePolicyDto,
  UpdateEmployeeSettingDto,
  UpdateNotificationSettingDto,
  UpdateSecurityPolicyDto,
  UpdateWorkflowDto,
  UpsertLeavePolicyDto,
} from './dto/policy.dto';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'Super_admin')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly attendancePolicy: AttendancePolicyService,
    private readonly leavePolicy: LeavePolicyService,
    private readonly holidayService: HolidayService,
    private readonly securityPolicy: SecurityPolicyService,
    private readonly workflowPolicy: WorkflowPolicyService,
  ) {}

  @Get()
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Get('organization')
  getOrganization() {
    return this.settingsService.getOrganization();
  }

  @Patch()
  updateSettings(@Body() dto: UpdateSystemSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }

  @Get('permissions')
  getPermissions() {
    return this.settingsService.getPermissions();
  }

  @Patch('permissions')
  async updatePermission(
    @Body() dto: UpdateRolePermissionDto,
    @Req() req: any,
  ) {
    if (!dto || !dto.roleName || !dto.moduleName) {
      return { success: false, message: 'Invalid payload ignored' };
    }

    return this.settingsService.updatePermission(dto, req.user);
  }

  @Get('audit-logs')
  async getAuditLogs(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('module') module?: string,
  ) {
    return this.settingsService.getAuditLogs({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      module,
    });
  }

  @Get('attendance')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  getAttendancePolicy() { return this.attendancePolicy.getPolicy(); }

  @Patch('attendance')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  updateAttendancePolicy(@Body() dto: UpdateAttendancePolicyDto, @Req() req: any) { return this.attendancePolicy.updatePolicy(dto, req.user); }

  @Get('leave')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  getLeavePolicies() { return this.leavePolicy.getPolicies(); }

  @Post('leave')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  upsertLeavePolicy(@Body() dto: UpsertLeavePolicyDto, @Req() req: any) { return this.leavePolicy.upsertPolicy(dto, req.user); }

  @Delete('leave/:id')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  deleteLeavePolicy(@Param('id', ParseIntPipe) id: number) { return this.leavePolicy.deletePolicy(id); }

  @Get('holidays')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  getHolidays() { return this.holidayService.getHolidays(); }

  @Post('holidays')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  createHoliday(@Body() dto: CreateHolidayPolicyDto, @Req() req: any) { return this.holidayService.createHoliday(dto, req.user); }

  @Delete('holidays/:id')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  deleteHoliday(@Param('id', ParseIntPipe) id: number) { return this.holidayService.deleteHoliday(id); }

  @Get('employee-lifecycle')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  getEmployeeLifecycle() { return this.settingsService.getEmployeeLifecycle(); }

  @Patch('employee-lifecycle')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  updateEmployeeLifecycle(@Body() dto: UpdateEmployeeSettingDto, @Req() req: any) { return this.settingsService.updateEmployeeLifecycle(dto, req.user); }

  @Get('security')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  getSecurityPolicy() { return this.securityPolicy.getPolicy(); }

  @Patch('security')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  updateSecurityPolicy(@Body() dto: UpdateSecurityPolicyDto, @Req() req: any) { return this.securityPolicy.updatePolicy(dto, req.user); }

  @Get('workflows')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  getWorkflows() { return this.workflowPolicy.getWorkflows(); }

  @Patch('workflows')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  updateWorkflow(@Body() dto: UpdateWorkflowDto, @Req() req: any) { return this.workflowPolicy.updateWorkflow(dto, req.user); }

  @Get('notifications')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  getNotifications() { return this.settingsService.getNotifications(); }

  @Patch('notifications')
  @Roles('SUPER_ADMIN', 'Super_admin', 'HR')
  updateNotifications(@Body() dto: UpdateNotificationSettingDto, @Req() req: any) { return this.settingsService.updateNotifications(dto, req.user); }
}
