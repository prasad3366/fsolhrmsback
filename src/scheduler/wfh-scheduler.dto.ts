import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WfhScheduler {

  constructor(private prisma: PrismaService) {}

  @Cron('0 0 * * *')
  async resetWFH() {

    const today = new Date();

    const expired = await this.prisma.wFHRequest.findMany({
      where: {
        endDate: { lt: today },
        status: 'APPROVED',
      },
    });

    for (const req of expired) {
      await this.prisma.employee.update({
        where: { id: req.employeeId },
        data: { workMode: 'OFFICE' },
      });
    }
  }
}
