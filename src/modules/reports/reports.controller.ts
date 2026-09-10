import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorators';
import { ReportsService } from './reports.service';
import { MonthlyAttendanceReportQueryDto } from './dto/monthly-attendance-report-query.dto';

const REPORT_ROLES = [
  'SUPER_ADMIN',
  'CEO',
  'HR',
  'FINANCE_MANAGER',
  'IT_MANAGER',
  'SALES_MANAGER',
];

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...REPORT_ROLES)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  getExecutiveSummary(@Req() req: any) {
    return this.reportsService.getExecutiveSummary(req.user);
  }

  @Get('export/employees')
  exportEmployees(@Req() req: any) {
    return this.reportsService.getEmployeeReportData(req.user);
  }

  @Get('export/attendance')
  exportAttendance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Req() req?: any,
  ) {
    return this.reportsService.getAttendanceReportData(startDate, endDate, req?.user);
  }

  @Get('export/training')
  exportTraining(@Req() req: any) {
    return this.reportsService.getTrainingReportData(req.user);
  }

  @Get('attendance/monthly')
  getMonthlyAttendance(
    @Req() req: any,
    @Query() query: MonthlyAttendanceReportQueryDto,
  ) {
    return this.reportsService.getMonthlyAttendanceReport(req.user, query);
  }
}
