import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HolidaysService {
  constructor(private prisma: PrismaService) {}

  // ✅ Create Holiday
  async createHoliday(data: any) {
    return this.prisma.holiday.create({
      data: {
        name: data.name,
        date: new Date(data.date),
        description: data.description,
        isOptional: data.isOptional ?? false,
        location: data.location,
      },
    });
  }

  // ✅ Get Holidays By Year
  async getHolidaysByYear(year: number) {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);

    return this.prisma.holiday.findMany({
      where: {
        date: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  // ✅ Update Holiday
  async updateHoliday(id: number, data: any) {
    return this.prisma.holiday.update({
      where: { id },
      data: {
        ...data,
        date: data.date ? new Date(data.date) : undefined,
      },
    });
  }

  // ✅ Delete Holiday
  async deleteHoliday(id: number) {
    await this.prisma.holiday.delete({
      where: { id },
    });

    return { message: 'Holiday deleted successfully' };
  }

  // ✅ Employee Holiday List
  async getEmployeeHolidayList(userId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
    });

    if (!employee) throw new BadRequestException('Employee not found');

    const year = new Date().getFullYear();

    return this.getHolidaysByYear(year);
  }

  // ✅ Used internally by attendance & leave
  async isHoliday(date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return this.prisma.holiday.findFirst({
      where: {
        date: {
          gte: start,
          lte: end,
        },
      },
    });
  }
}
