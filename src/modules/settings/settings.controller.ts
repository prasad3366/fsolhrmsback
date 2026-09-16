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
import { HolidaysService } from '../../holidays/holidays.service';
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

const ORGANIZATION_MANAGEMENT_ROLES = ['SUPER_ADMIN', 'Super_admin', 'CEO', 'HR'];

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ORGANIZATION_MANAGEMENT_ROLES)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly attendancePolicy: AttendancePolicyService,
    private readonly leavePolicy: LeavePolicyService,
    private readonly holidaysService: HolidaysService,
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
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  getAttendancePolicy() { return this.attendancePolicy.getPolicy(); }

  @Patch('attendance')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  updateAttendancePolicy(@Body() dto: UpdateAttendancePolicyDto, @Req() req: any) { return this.attendancePolicy.updatePolicy(dto, req.user); }

  @Get('leave')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  getLeavePolicies() { return this.leavePolicy.getPolicies(); }

  @Post('leave')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  upsertLeavePolicy(@Body() dto: UpsertLeavePolicyDto, @Req() req: any) { return this.leavePolicy.upsertPolicy(dto, req.user); }

  @Delete('leave/:id')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  deleteLeavePolicy(@Param('id', ParseIntPipe) id: number) { return this.leavePolicy.deletePolicy(id); }

  @Get('holidays')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  getHolidays() { return this.holidaysService.getAllHolidays(); }

  @Post('holidays')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  createHoliday(@Body() dto: CreateHolidayPolicyDto) {
    return this.holidaysService.createHoliday({
      name: dto.title,
      date: dto.date,
      description: dto.description,
      isOptional: dto.isOptional,
    }, {
      title: dto.title,
      branchId: dto.branchId,
    });
  }

  @Delete('holidays/:id')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  deleteHoliday(@Param('id', ParseIntPipe) id: number) {
    return this.holidaysService.deleteHoliday(id, true);
  }

  @Get('employee-lifecycle')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  getEmployeeLifecycle() { return this.settingsService.getEmployeeLifecycle(); }

  @Patch('employee-lifecycle')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  updateEmployeeLifecycle(@Body() dto: UpdateEmployeeSettingDto, @Req() req: any) { return this.settingsService.updateEmployeeLifecycle(dto, req.user); }

  @Get('security')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  getSecurityPolicy() { return this.securityPolicy.getPolicy(); }

  @Patch('security')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  updateSecurityPolicy(@Body() dto: UpdateSecurityPolicyDto, @Req() req: any) { return this.securityPolicy.updatePolicy(dto, req.user); }

  @Get('workflows')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  getWorkflows() { return this.workflowPolicy.getWorkflows(); }

  @Patch('workflows')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  updateWorkflow(@Body() dto: UpdateWorkflowDto, @Req() req: any) { return this.workflowPolicy.updateWorkflow(dto, req.user); }

  @Get('notifications')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  getNotifications() { return this.settingsService.getNotifications(); }

  @Patch('notifications')
  @Roles(...ORGANIZATION_MANAGEMENT_ROLES)
  updateNotifications(@Body() dto: UpdateNotificationSettingDto, @Req() req: any) { return this.settingsService.updateNotifications(dto, req.user); }
}
