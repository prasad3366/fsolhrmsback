import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWfhDto } from './dto/wfh-request.dto';
import { WorkingDaysService } from '../common/working-days/working-days.service';

@Injectable()
export class WfhService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workingDaysService: WorkingDaysService,
  ) {}

  private parseBusinessDate(value: string): Date {
    if (typeof value !== 'string') {
      throw new BadRequestException('Invalid date format');
    }

    const datePart = value.slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);

    if (!match || Number.isNaN(new Date(value).getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const [, yearText, monthText, dayText] = match;
    const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));

    if (
      date.getFullYear() !== Number(yearText) ||
      date.getMonth() !== Number(monthText) - 1 ||
      date.getDate() !== Number(dayText)
    ) {
      throw new BadRequestException('Invalid date format');
    }

    return date;
  }

  private getDateRange(start: Date, end: Date): Date[] {
    const dates: Date[] = [];

    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      dates.push(new Date(date));
    }

    return dates;
  }

  private isSerializationConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2034'
    );
  }

  // ==================================
  // Employee → Request WFH
  // ==================================
  async request(employeeId: number, dto: RequestWfhDto) {
    const { startDate, endDate, reason } = dto;

    if (!startDate || !endDate) {
      throw new BadRequestException('Start date and End date are required');
    }

    if (reason !== undefined && (typeof reason !== 'string' || reason.trim() === '')) {
      throw new BadRequestException('Reason must be a non-empty string');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const start = this.parseBusinessDate(startDate);
        const end = this.parseBusinessDate(endDate);

        if (start > end) {
          throw new BadRequestException('Start date cannot be after end date');
        }

        const workingDates = await this.workingDaysService.getWorkingDates(
          employeeId,
          this.getDateRange(start, end),
        );

        if (workingDates.length === 0) {
          throw new BadRequestException('WFH request must include at least one working day');
        }

        const overlap = await tx.wFHRequest.findFirst({
          where: {
            employeeId,
            status: { in: ['PENDING', 'APPROVED'] },
            startDate: { lte: end },
            endDate: { gte: start },
          },
        });

        if (overlap) {
          throw new BadRequestException('WFH already requested for this period');
        }

        return tx.wFHRequest.create({
          data: {
            employeeId,
            startDate: start,
            endDate: end,
            reason: reason ?? null, // ⭐ Save reason
            status: 'PENDING',
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException('WFH request conflicts with another request');
      }
      throw error;
    }
  }

  // ==================================
  // HR → Approve WFH
  // ==================================
  async approve(requestId: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.wFHRequest.findUnique({
          where: { id: requestId },
        });

        if (!request) {
          throw new BadRequestException('WFH request not found');
        }

        if (request.status !== 'PENDING') {
          throw new BadRequestException(
            `Cannot approve request with status ${request.status}`,
          );
        }

        const overlap = await tx.wFHRequest.findFirst({
          where: {
            employeeId: request.employeeId,
            id: { not: requestId },
            status: 'APPROVED',
            startDate: { lte: request.endDate },
            endDate: { gte: request.startDate },
          },
        });

        if (overlap) {
          throw new BadRequestException('WFH already approved for this period');
        }

        return tx.wFHRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED' },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException('WFH approval conflicts with another request');
      }
      throw error;
    }
  }

  // ==================================
  // HR → Reject WFH
  // ==================================
  async reject(requestId: number) {
    const request = await this.prisma.wFHRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new BadRequestException('WFH request not found');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot reject request with status ${request.status}`,
      );
    }

    return this.prisma.wFHRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED' },
    });
  }

  // ==================================
  // HR → View All Requests
  // ==================================
  async getAll(teamIds?: number[]) {
    if (teamIds && teamIds.length === 0) {
      return [];
    }

    return this.prisma.wFHRequest.findMany({
      where: teamIds
        ? { employee: { teamId: { in: teamIds } } }
        : undefined,
      include: {
        employee: {
          select: {
            id: true,
            empCode: true,
            firstName: true,
            lastName: true,
            department: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==================================
  // Employee → My Requests
  // ==================================
  async getMyRequests(employeeId: number) {
    return this.prisma.wFHRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
