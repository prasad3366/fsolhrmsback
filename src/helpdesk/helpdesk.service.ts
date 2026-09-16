import { ForbiddenException, Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { ActionType, NotificationEntityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHelpdeskDto } from './dto/create-helpdesk.dto';
import {
  AuthorizationService,
  AuthorizationUser,
} from '../common/authorization/authorization.service';
import { NotificationService } from '../modules/notifications/notification.service';

@Injectable()
export class HelpdeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly notificationService?: NotificationService,
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

  private async resolveHelpdeskRecipients() {
    const recipients = await this.prisma.user.findMany({
      where: {
        role: {
          in: ['SUPER_ADMIN', 'CEO', 'HR'],
        },
      },
      select: {
        id: true,
        role: true,
      },
    });

    return recipients.filter((user) => !!user.id && ['SUPER_ADMIN', 'CEO', 'HR'].includes(String(user.role || '').toUpperCase()));
  }

  private async notifyHelpdeskTicketCreated(ticketId: number) {
    if (!this.notificationService) {
      return;
    }

    const recipients = await this.resolveHelpdeskRecipients();

    for (const recipient of recipients) {
      await this.notificationService.createNotification({
        recipientUserId: recipient.id,
        entityType: NotificationEntityType.HELPDESK,
        entityId: ticketId,
        title: 'Helpdesk ticket pending approval',
        message: 'A new helpdesk ticket requires review and handling.',
      });

      try {
        await this.notificationService.createActionItem({
          recipientUserId: recipient.id,
          entityType: NotificationEntityType.HELPDESK,
          entityId: ticketId,
          actionType: ActionType.REVIEW,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) {
          throw error;
        }
      }
    }
  }

  private async notifyHelpdeskDecision(ticketId: number, decision: 'APPROVED' | 'RESOLVED', requesterUserId: number) {
    if (!this.notificationService) {
      return;
    }

    await this.notificationService.resolveActionItemsForEntity({
      entityType: NotificationEntityType.HELPDESK,
      entityId: ticketId,
    });

    const decisionText = decision === 'APPROVED' ? 'approved' : 'resolved';

    await this.notificationService.createNotification({
      recipientUserId: requesterUserId,
      entityType: NotificationEntityType.HELPDESK,
      entityId: ticketId,
      title: `Helpdesk ticket ${decisionText}`,
      message: `Your helpdesk ticket has been ${decisionText}.`,
    });
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

    const ticket = await this.prisma.helpdeskTicket.create({
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

    await this.notifyHelpdeskTicketCreated(ticket.id);
    return ticket;
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

    const approvedTicket = await this.prisma.helpdeskTicket.findUnique({
      where: { id: ticketId },
    });

    if (approvedTicket?.userId !== null && approvedTicket?.userId !== undefined) {
      await this.notifyHelpdeskDecision(ticketId, 'APPROVED', approvedTicket.userId);
    }

    return approvedTicket;
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

    const resolvedTicket = await this.prisma.helpdeskTicket.findUnique({
      where: { id: ticketId },
    });

    if (resolvedTicket?.userId !== null && resolvedTicket?.userId !== undefined) {
      await this.notifyHelpdeskDecision(ticketId, 'RESOLVED', resolvedTicket.userId);
    }

    return resolvedTicket;
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
