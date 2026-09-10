import { ForbiddenException, Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHelpdeskDto } from './dto/create-helpdesk.dto';
import {
  AuthorizationService,
  AuthorizationUser,
} from '../common/authorization/authorization.service';

@Injectable()
export class HelpdeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  private assertManagementAccess(actor: AuthorizationUser | undefined) {
    if (!this.authorizationService.canAccessOrganizationWide(actor, 'helpdesk')) {
      throw new ForbiddenException('Access denied');
    }
  }

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
    if (
      typeof dto?.issue !== 'string' ||
      dto.issue.trim().length === 0 ||
      typeof dto?.reason !== 'string' ||
      dto.reason.trim().length === 0
    ) {
      throw new BadRequestException('Issue and reason are required');
    }

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
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  async approve(ticketId: number, actor: AuthorizationUser | undefined) {
    this.assertManagementAccess(actor);

    const transition = await this.prisma.helpdeskTicket.updateMany({
      where: { id: ticketId, status: 'PENDING' },
      data: { status: 'APPROVED' },
    });

    if (transition.count !== 1) {
      const ticket = await this.prisma.helpdeskTicket.findUnique({
        where: { id: ticketId },
      });

      if (!ticket) {
        throw new BadRequestException('Helpdesk ticket not found');
      }

      throw new BadRequestException(
        `Cannot approve ticket with status ${ticket.status}`,
      );
    }

    return this.prisma.helpdeskTicket.findUnique({
      where: { id: ticketId },
    });
  }

  async resolve(ticketId: number, actor: AuthorizationUser | undefined) {
    this.assertManagementAccess(actor);

    const transition = await this.prisma.helpdeskTicket.updateMany({
      where: { id: ticketId, status: 'APPROVED' },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    if (transition.count !== 1) {
      const ticket = await this.prisma.helpdeskTicket.findUnique({
        where: { id: ticketId },
      });

      if (!ticket) {
        throw new BadRequestException('Helpdesk ticket not found');
      }

      throw new BadRequestException(
        `Cannot resolve ticket with status ${ticket.status}`,
      );
    }

    return this.prisma.helpdeskTicket.findUnique({
      where: { id: ticketId },
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
        user: {
          select: {
            id: true,
            email: true,
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
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
