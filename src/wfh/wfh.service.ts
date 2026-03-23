import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWfhDto } from './dto/wfh-request.dto';

@Injectable()
export class WfhService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================================
  // Employee → Request WFH
  // ==================================
  async request(employeeId: number, dto: RequestWfhDto) {
    const { startDate, endDate, reason } = dto;

    if (!startDate || !endDate) {
      throw new BadRequestException('Start date and End date are required');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (start > end) {
      throw new BadRequestException('Start date cannot be after end date');
    }

    // ✅ Prevent overlapping WFH
    const overlap = await this.prisma.wFHRequest.findFirst({
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

    return this.prisma.wFHRequest.create({
      data: {
        employeeId,
        startDate: start,
        endDate: end,
        reason: reason ?? null, // ⭐ Save reason
        status: 'PENDING',
      },
    });
  }

  // ==================================
  // HR → Approve WFH
  // ==================================
  async approve(requestId: number) {
    const request = await this.prisma.wFHRequest.findUnique({
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

    return this.prisma.wFHRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED' },
    });
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
  async getAll() {
    return this.prisma.wFHRequest.findMany({
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
