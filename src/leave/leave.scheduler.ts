import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { getFinancialYearStart } from './utils/financial-year.util';

@Injectable()
export class LeaveScheduler {
  constructor(private prisma: PrismaService) {}

  // ⭐ MONTHLY ACCRUAL
  @Cron('0 0 1 * *')
  async monthlyAccrual() {
    const balances = await this.prisma.leaveBalance.findMany({
      include: { leaveType: true },
    });

    for (const b of balances) {
      if (!b.leaveType.monthlyAccrual) continue;

      await this.prisma.leaveBalance.update({
        where: {
          employeeId_leaveTypeId_yearStart: {
            employeeId: b.employeeId,
            leaveTypeId: b.leaveTypeId,
            yearStart: b.yearStart,
          },
        },
        data: {
          allocated: { increment: b.leaveType.monthlyAccrual },
        },
      });
    }
  }

  // ⭐ MARCH 31 → CARRY FORWARD
  @Cron('0 0 31 3 *')
  async carryForward() {
    const balances = await this.prisma.leaveBalance.findMany({
      include: { leaveType: true },
    });

    for (const b of balances) {
      if (!b.leaveType.carryForward) continue;

      const remaining = b.allocated + b.carryForward - b.used;

      await this.prisma.leaveBalance.update({
        where: {
          employeeId_leaveTypeId_yearStart: {
            employeeId: b.employeeId,
            leaveTypeId: b.leaveTypeId,
            yearStart: b.yearStart,
          },
        },
        data: {
          carryForward: Math.min(
            remaining,
            b.leaveType.maxCarryLimit ?? remaining,
          ),
        },
      });
    }
  }

  // ⭐ APRIL 1 → NEW YEAR
  @Cron('0 0 1 4 *')
  async newFinancialYear() {
    const employees = await this.prisma.employee.findMany();
    const leaveTypes = await this.prisma.leaveType.findMany();

    const yearStart = getFinancialYearStart(new Date());

    const data = employees.flatMap((emp) =>
      leaveTypes.map((type) => ({
        employeeId: emp.id,
        leaveTypeId: type.id,
        allocated: type.yearlyQuota,
        yearStart,
      })),
    );

    await this.prisma.leaveBalance.createMany({
      data,
      skipDuplicates: true,
    });
  }
}
