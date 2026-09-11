import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HolidaysService } from '../../holidays/holidays.service';
import { getBusinessDateKey } from '../../attendance/utils/business-date.util';

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
      const businessDate = getBusinessDateKey(date);
      const day = new Date(`${businessDate}T00:00:00.000Z`).getUTCDay();
      return day !== 0 && (isSales || day !== 6);
    });

    const holidayResults = await Promise.all(
      eligibleDates.map((date) => this.holidayService.isHoliday(date)),
    );

    return eligibleDates.filter((_date, index) => !holidayResults[index]);
  }
}