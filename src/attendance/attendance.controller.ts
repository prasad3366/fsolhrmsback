import {
  Controller,
  Post,
  Body,
  Req,
  Get,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';

import { AttendanceService } from './attendance.service';
import { PunchDto } from './dto/punch.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OfficeLocationDto } from './dto/office-location.dto';

import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  // ============================
  // EMPLOYEE PUNCH IN
  // ============================
  @Post('punch-in')
  punchIn(@Req() req, @Body() dto: PunchDto) {
    const lat = dto.latitude;
    const lng = dto.longitude;

    if (lat == null || lng == null) {
      throw new BadRequestException('Latitude & Longitude required');
    }

    return this.service.punchIn(req.user.employeeId, lat, lng);
  }

  // ============================
  // EMPLOYEE PUNCH OUT
  // ============================
  @Post('punch-out')
  punchOut(@Req() req, @Body() dto: PunchDto) {
    const lat = dto.latitude;
    const lng = dto.longitude;

    if (lat == null || lng == null) {
      throw new BadRequestException('Latitude & Longitude required');
    }

    return this.service.punchOut(req.user.employeeId, lat, lng);
  }

  // ============================
  // HR / ADMIN / MANAGER
  // VIEW ALL ATTENDANCE
  // ============================
  @Get('all')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR', 'MANAGER')
  getAll() {
    return this.service.getAll();
  }

  // ============================
  // HR / ADMIN / MANAGER
  // VIEW EMPLOYEE ATTENDANCE
  // ============================
  @Get('employee/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR', 'MANAGER')
  getUser(@Param('id') id: string) {
    return this.service.getUser(Number(id));
  }

  // ============================
  // HR / ADMIN
  // SET OFFICE LOCATION
  // ============================
  @Post('location')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR')
  setOfficeLocation(@Body() dto: OfficeLocationDto) {
    return this.service.setOfficeLocation(dto);
  }

  // ============================
  // EMPLOYEE SELF ATTENDANCE
  // ============================
  @Get('my-history')
  getMyAttendance(@Req() req) {
    return this.service.getMyAttendance(req.user.employeeId);
  }
}
