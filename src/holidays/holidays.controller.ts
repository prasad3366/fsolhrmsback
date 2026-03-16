import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { HolidaysService } from './holidays.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { Role } from '@prisma/client';

@Controller('holidays')
@UseGuards(JwtAuthGuard)
export class HolidaysController {
  constructor(private readonly service: HolidaysService) {}

  // ✅ 1. Add Holiday (HR / ADMIN)
  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.HR)
  create(@Body() body: any) {
    return this.service.createHoliday(body);
  }

  // ✅ 2. Get Holidays By Year
  @Get()
  getByYear(@Query('year') year: string) {
    return this.service.getHolidaysByYear(Number(year));
  }

  // ✅ 3. Update Holiday
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.HR)
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.updateHoliday(Number(id), body);
  }

  // ✅ 4. Delete Holiday
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.HR)
  remove(@Param('id') id: string) {
    return this.service.deleteHoliday(Number(id));
  }

  // ✅ 5. Employee Holiday View
  @Get('my')
  getMyHolidays(@Req() req) {
    return this.service.getEmployeeHolidayList(req.user.id);
  }
}
