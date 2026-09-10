import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HolidaysService } from '../../holidays/holidays.service';

@Injectable()
export class WorkingDaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holidayService: HolidaysService,
  ) {}

  async getWorkingDates(employeeId: number, dates: Date[]): Promise<Date[]> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, team: { select: { name: true } } },
    });

    if (!employee) throw new NotFoundException('Employee not found');

    const isSales = employee.team?.name?.toUpperCase() === 'SALES';
    const eligibleDates = dates.filter((date) => {
      const day = date.getDay();
      return day !== 0 && (isSales || day !== 6);
    });

    const holidayResults = await Promise.all(
      eligibleDates.map((date) => this.holidayService.isHoliday(date)),
    );

    return eligibleDates.filter((_date, index) => !holidayResults[index]);
  }
}