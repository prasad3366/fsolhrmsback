import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';

@Injectable()
export class HolidaysService {
  constructor(private prisma: PrismaService) {}

  private normalizeBusinessDate(value: string | Date): Date {
    if (typeof value === 'string') {
      const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (dateOnly) {
        const year = Number(dateOnly[1]);
        const month = Number(dateOnly[2]);
        const day = Number(dateOnly[3]);
        const normalized = new Date(year, month - 1, day);
        if (
          normalized.getFullYear() !== year ||
          normalized.getMonth() !== month - 1 ||
          normalized.getDate() !== day
        ) {
          throw new BadRequestException('Invalid holiday date');
        }
        return normalized;
      }
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid holiday date');
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private validateFields(data: Record<string, unknown>, required: string[] = []) {
    const allowed = ['name', 'date', 'description', 'isOptional', 'location'];
    const unknown = Object.keys(data).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new BadRequestException(`Unknown holiday field: ${unknown[0]}`);
    for (const field of required) {
      if (typeof data[field] !== 'string' || !(data[field] as string).trim()) {
        throw new BadRequestException(`Invalid holiday ${field}`);
      }
    }
    if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim())) {
      throw new BadRequestException('Invalid holiday name');
    }
    if (data.date !== undefined) this.normalizeBusinessDate(data.date as string);
    if (data.description !== undefined && typeof data.description !== 'string') {
      throw new BadRequestException('Invalid holiday description');
    }
    if (data.isOptional !== undefined && typeof data.isOptional !== 'boolean') {
      throw new BadRequestException('Invalid holiday isOptional');
    }
    if (data.location !== undefined && typeof data.location !== 'string') {
      throw new BadRequestException('Invalid holiday location');
    }
  }

  private validateYear(year: number) {
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new BadRequestException('Invalid holiday year');
    }
  }

  private normalizeLocation(value: string | null | undefined) {
    return value?.trim().toLocaleUpperCase() ?? null;
  }

  private rethrowDuplicate(error: unknown): never {
    if ((error as { code?: string })?.code === 'P2002') {
      throw new BadRequestException('Duplicate holiday');
    }
    throw error;
  }

  private rethrowNotFound(error: unknown): never {
    if ((error as { code?: string })?.code === 'P2025') {
      throw new NotFoundException('Holiday not found');
    }
    throw error;
  }

  private async ensureDatePeriodUnlocked(date: Date) {
    const payroll = await this.prisma.payroll.findFirst({
      where: {
        month: date.getMonth() + 1,
        year: date.getFullYear(),
        status: { in: ['FINALIZED', 'PAID'] },
      },
      select: { id: true },
    });

    if (payroll) {
      throw new BadRequestException(
        'Holiday cannot be changed for a finalized or paid payroll period',
      );
    }
  }

  // ✅ Create Holiday
  async createHoliday(data: CreateHolidayDto) {
    this.validateFields(data as unknown as Record<string, unknown>, ['name', 'date']);
    const date = this.normalizeBusinessDate(data.date);
    await this.ensureDatePeriodUnlocked(date);
    try {
      return await this.prisma.holiday.create({
        data: {
          name: data.name,
          date,
          description: data.description,
          isOptional: data.isOptional ?? false,
          location: data.location,
        },
      });
    } catch (error) {
      this.rethrowDuplicate(error);
    }
  }

  // ✅ Get Holidays By Year
  async getHolidaysByYear(year: number) {
    this.validateYear(year);
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    return this.prisma.holiday.findMany({
      where: {
        date: {
          gte: start,
          lt: end,
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  async getHolidayById(id: number) {
    const holiday = await this.prisma.holiday.findUnique({ where: { id } });
    if (!holiday) throw new NotFoundException('Holiday not found');
    return holiday;
  }

  // ✅ Update Holiday
  async updateHoliday(id: number, data: UpdateHolidayDto) {
    this.validateFields(data as unknown as Record<string, unknown>);
    const existingHoliday = await this.prisma.holiday.findUnique({ where: { id } });
    if (!existingHoliday) throw new NotFoundException('Holiday not found');
    await this.ensureDatePeriodUnlocked(existingHoliday.date);
    const updatedDate = data.date ? this.normalizeBusinessDate(data.date) : undefined;
    if (updatedDate) await this.ensureDatePeriodUnlocked(updatedDate);
    try {
      return await this.prisma.holiday.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(updatedDate !== undefined && { date: updatedDate }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.isOptional !== undefined && { isOptional: data.isOptional }),
          ...(data.location !== undefined && { location: data.location }),
        },
      });
    } catch (error) {
      this.rethrowNotFound(error);
    }
  }

  // ✅ Delete Holiday
  async deleteHoliday(id: number) {
    const existingHoliday = await this.prisma.holiday.findUnique({ where: { id } });
    if (!existingHoliday) throw new NotFoundException('Holiday not found');
    await this.ensureDatePeriodUnlocked(existingHoliday.date);
    try {
      await this.prisma.holiday.delete({
        where: { id },
      });
    } catch (error) {
      this.rethrowNotFound(error);
    }

    return { message: 'Holiday deleted successfully' };
  }

  // ✅ Employee Holiday List
  async getEmployeeHolidayList(userId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
    });

    if (!employee) throw new BadRequestException('Employee not found');

    const year = new Date().getFullYear();
    const holidays = await this.getHolidaysByYear(year);
    const employeeLocation = this.normalizeLocation(employee.city);

    return holidays.filter(
      (holiday) =>
        holiday.location === null ||
        this.normalizeLocation(holiday.location) === employeeLocation,
    );
  }

  // ✅ Used internally by attendance & leave
  async isHoliday(date: Date) {
    const start = this.normalizeBusinessDate(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return this.prisma.holiday.findFirst({
      where: {
        date: {
          gte: start,
          lt: end,
        },
      },
    });
  }
}
