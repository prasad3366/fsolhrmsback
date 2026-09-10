import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../audit.service';
import { CreateHolidayPolicyDto } from '../dto/policy.dto';

@Injectable()
export class HolidayService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  getHolidays() {
    return this.prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  }

  async createHoliday(dto: CreateHolidayPolicyDto, reqUser: any) {
    const holiday = await this.prisma.holiday.create({
      data: {
        title: dto.title,
        name: dto.title,
        date: new Date(dto.date),
        description: dto.description,
        isOptional: dto.isOptional ?? false,
        branchId: dto.branchId,
      },
    });
    await this.audit.logAction({ userId: reqUser?.id, userEmail: reqUser?.email ?? 'unknown', action: 'HOLIDAY_CREATED', module: 'SETTINGS', newVal: holiday });
    return holiday;
  }

  async deleteHoliday(id: number) {
    const previous = await this.prisma.holiday.findUnique({ where: { id } });
    if (!previous) throw new NotFoundException('Holiday not found');
    const deleted = await this.prisma.holiday.delete({ where: { id } });
    await this.audit.logAction({ userEmail: 'system', action: 'HOLIDAY_DELETED', module: 'SETTINGS', previousVal: deleted });
    return deleted;
  }
}
