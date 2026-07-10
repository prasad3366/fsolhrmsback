import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';

import { DashboardService } from './dashboard.service';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';

import type { Request, Response } from 'express';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  /* Quick action: HR/Admin/Manager export the attendance CSV report for a month.
     Manager scope is limited to their own team's members inside the service. */

  @Get('export-attendance')
  @Roles('ADMIN', 'HR', 'MANAGER')
  async exportAttendance(
    @Query('month') month: string,
    @Query('year') year: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const now = new Date();
    const m = month ? Number(month) : now.getMonth() + 1;
    const y = year ? Number(year) : now.getFullYear();

    if (!m || m < 1 || m > 12 || !y) {
      throw new BadRequestException('Invalid month/year');
    }

    const user = req.user as any;
    const csv = await this.dashboardService.exportAttendanceCsv(m, y, user);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=attendance-report-${y}-${String(m).padStart(2, '0')}.csv`,
    );
    res.send(csv);
  }
}
