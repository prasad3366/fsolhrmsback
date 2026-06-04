import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHelpdeskDto } from './dto/create-helpdesk.dto';

@Injectable()
export class HelpdeskService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveEmployeeId(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { employee: true },
    });

    if (!user || !user.employee) {
      throw new BadRequestException('Employee record not found for user');
    }

    return user.employee.id;
  }

  async create(userId: number, dto: CreateHelpdeskDto) {
    const resolvedEmployeeId = await this.resolveEmployeeId(userId);
    const { issue, reason } = dto;

    return this.prisma.helpdeskTicket.create({
      data: {
        userId,
        employeeId: resolvedEmployeeId,
        issue,
        reason,
        status: 'PENDING',
      },
    });
  }

  async approve(ticketId: number) {
    const ticket = await this.prisma.helpdeskTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new BadRequestException('Helpdesk ticket not found');
    }

    if (ticket.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot approve ticket with status ${ticket.status}`,
      );
    }

    return this.prisma.helpdeskTicket.update({
      where: { id: ticketId },
      data: { status: 'APPROVED' },
    });
  }

  async resolve(ticketId: number) {
    const ticket = await this.prisma.helpdeskTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new BadRequestException('Helpdesk ticket not found');
    }

    if (ticket.status !== 'APPROVED') {
      throw new BadRequestException(
        `Cannot resolve ticket with status ${ticket.status}`,
      );
    }

    return this.prisma.helpdeskTicket.update({
      where: { id: ticketId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  async getAll() {
    return this.prisma.helpdeskTicket.findMany({
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

  async getMine(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { employee: true },
    });

    const employeeId = user?.employee?.id ?? null;
    const where = employeeId
      ? { OR: [{ userId }, { employeeId }] }
      : { userId };

    return this.prisma.helpdeskTicket.findMany({
      where,
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
}
