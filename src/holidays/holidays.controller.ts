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
  BadRequestException,
} from '@nestjs/common';

import { HolidaysService } from './holidays.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { Role } from '@prisma/client';
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';

export class PositiveHolidayIdPipe {
  transform(value: string) {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException('Validation failed (positive safe integer is expected)');
    }
    const parsedValue = Number(value);
    if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
      throw new BadRequestException('Validation failed (positive safe integer is expected)');
    }
    return parsedValue;
  }
}

export class HolidayYearPipe {
  transform(value: string) {
    if (!/^\d{4}$/.test(value)) {
      throw new BadRequestException('Validation failed (valid four-digit year is expected)');
    }
    const parsedValue = Number(value);
    if (parsedValue < 1900 || parsedValue > 2100) {
      throw new BadRequestException('Validation failed (year is out of range)');
    }
    return parsedValue;
  }
}

@Controller('holidays')
@UseGuards(JwtAuthGuard)
export class HolidaysController {
  constructor(private readonly service: HolidaysService) {}

  // ✅ 1. Add Holiday (SUPER_ADMIN / CEO / HR)
  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CEO, Role.HR)
  create(@Body() body: CreateHolidayDto) {
    return this.service.createHoliday(body);
  }

  // ✅ 2. Get Holidays By Year
  @Get()
  getByYear(@Query('year', HolidayYearPipe) year: number) {
    return this.service.getHolidaysByYear(year);
  }

  // ✅ 3. Update Holiday
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CEO, Role.HR)
  update(@Param('id', PositiveHolidayIdPipe) id: number, @Body() body: UpdateHolidayDto) {
    return this.service.updateHoliday(id, body);
  }

  // ✅ 4. Delete Holiday
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CEO, Role.HR)
  remove(@Param('id', PositiveHolidayIdPipe) id: number) {
    return this.service.deleteHoliday(id);
  }

  // ✅ 5. Employee Holiday View
  @Get('my')
  getMyHolidays(@Req() req) {
    return this.service.getEmployeeHolidayList(req.user.id);
  }

  @Get(':id')
  getById(@Param('id', PositiveHolidayIdPipe) id: number) {
    return this.service.getHolidayById(id);
  }
}
