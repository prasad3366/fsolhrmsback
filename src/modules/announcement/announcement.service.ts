import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnnouncementAudience, NotificationEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Injectable()
export class AnnouncementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService?: NotificationService,
  ) {}

  private readonly globalCreateRoles = new Set(['SUPER_ADMIN', 'CEO', 'HR', 'HR_MANAGER']);

  private readonly teamManagerRoles = new Set(['MANAGER', 'IT_MANAGER', 'SALES_MANAGER']);

  private normalizeRole(role?: string | null): string {
    return String(role ?? '').trim().toUpperCase();
  }

  private async resolveEmployeeContext(employeeId?: number | null, userRole?: string | null) {
    const normalizedRole = this.normalizeRole(userRole);
    const employee =
      employeeId !== null && employeeId !== undefined
        ? await this.prisma.employee.findUnique({
            where: { id: employeeId },
            select: {
              department: true,
              teamId: true,
            },
          })
        : null;

    const departmentId = employee?.department ?? null;
    const teamId = employee?.teamId ?? null;

    if (this.teamManagerRoles.has(normalizedRole) && teamId === null) {
      const managedTeam = await this.prisma.team.findFirst({ where: { managerId: employeeId! } });
      return {
        departmentId,
        teamId: managedTeam?.id ?? null,
      };
    }

    return {
      departmentId,
      teamId,
    };
  }

  private async resolveManagedTeamId(employeeId?: number | null) {
    if (!employeeId) {
      return null;
    }

    const team = await this.prisma.team.findFirst({ where: { managerId: employeeId } });
    return team?.id ?? null;
  }

  private async assertCanCreateAnnouncement(dto: CreateAnnouncementDto, reqUser: any) {
    const normalizedRole = this.normalizeRole(reqUser?.role);

    if (this.globalCreateRoles.has(normalizedRole)) {
      return;
    }

    if (this.teamManagerRoles.has(normalizedRole)) {
      const managedTeamId = await this.resolveManagedTeamId(reqUser?.employeeId);
      if (!managedTeamId) {
        throw new ForbiddenException('You are not assigned to a team that can create announcements');
      }

      if (dto.targetAudience && dto.targetAudience !== AnnouncementAudience.TEAM) {
        throw new ForbiddenException('Managers can only publish team announcements');
      }

      return;
    }

    throw new ForbiddenException('You do not have permission to create announcements');
  }

  private async assertAnnouncementVisible(announcement: any, reqUser: any) {
    const normalizedRole = this.normalizeRole(reqUser?.role);

    if (this.globalCreateRoles.has(normalizedRole)) {
      return;
    }

    const context = await this.resolveEmployeeContext(reqUser?.employeeId, reqUser?.role);

    if (announcement.targetAudience === AnnouncementAudience.ALL) {
      return;
    }

    if (announcement.targetAudience === AnnouncementAudience.TEAM) {
      const managedTeamId = await this.resolveManagedTeamId(reqUser?.employeeId);
      if (reqUser?.employeeId && context.teamId && announcement.teamId === context.teamId) {
        return;
      }
      if (managedTeamId && announcement.teamId === managedTeamId) {
        return;
      }
      throw new ForbiddenException('You are not allowed to view this announcement');
    }

    if (announcement.targetAudience === AnnouncementAudience.DEPARTMENT) {
      if (context.departmentId && announcement.departmentId === String(context.departmentId)) {
        return;
      }
      throw new ForbiddenException('You are not allowed to view this announcement');
    }

    throw new ForbiddenException('You are not allowed to view this announcement');
  }

  private async assertAnnouncementManageable(announcement: any, reqUser: any) {
    const normalizedRole = this.normalizeRole(reqUser?.role);

    if (this.globalCreateRoles.has(normalizedRole)) {
      return;
    }

    if (!this.teamManagerRoles.has(normalizedRole)) {
      throw new ForbiddenException('You are not allowed to manage this announcement');
    }

    const managedTeamId = await this.resolveManagedTeamId(reqUser?.employeeId);
    if (announcement.targetAudience !== AnnouncementAudience.TEAM) {
      throw new ForbiddenException('Only team announcements can be managed by managers');
    }

    if (!managedTeamId || announcement.teamId !== managedTeamId) {
      throw new ForbiddenException('This announcement belongs to another team');
    }
  }

  private async resolveAnnouncementTargetUserIds(announcement: {
    targetAudience: AnnouncementAudience;
    teamId?: number | null;
    departmentId?: string | null;
  }): Promise<number[]> {
    if (announcement.targetAudience === AnnouncementAudience.ALL) {
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      return users.map((user) => user.id);
    }

    if (announcement.targetAudience === AnnouncementAudience.TEAM) {
      if (!announcement.teamId) {
        return [];
      }

      const employees = await this.prisma.employee.findMany({
        where: { teamId: announcement.teamId },
        select: { userId: true },
      });
      return employees
        .map((employee) => employee.userId)
        .filter((userId): userId is number => typeof userId === 'number');
    }

    if (announcement.targetAudience === AnnouncementAudience.DEPARTMENT) {
      if (!announcement.departmentId) {
        return [];
      }

      const employees = await this.prisma.employee.findMany({
        where: { department: announcement.departmentId },
        select: { userId: true },
      });
      return employees
        .map((employee) => employee.userId)
        .filter((userId): userId is number => typeof userId === 'number');
    }

    return [];
  }

  private async notifyAnnouncementPublished(announcement: {
    id: number;
    title: string;
    targetAudience: AnnouncementAudience;
    teamId?: number | null;
    departmentId?: string | null;
  }) {
    if (!this.notificationService) {
      return;
    }

    const recipientUserIds = await this.resolveAnnouncementTargetUserIds(announcement);
    for (const recipientUserId of recipientUserIds) {
      await this.notificationService.createNotification({
        recipientUserId,
        entityType: NotificationEntityType.ANNOUNCEMENT,
        entityId: announcement.id,
        title: `New announcement: ${announcement.title}`,
        message: `A new announcement is available: ${announcement.title}.`,
      });
    }
  }

  async createAnnouncement(
    dto: CreateAnnouncementDto,
    reqUser: { id: number; role: string; employeeId?: number | null; departmentId?: string | number | null },
  ) {
    await this.assertCanCreateAnnouncement(dto, reqUser);

    const normalizedRole = this.normalizeRole(reqUser?.role);
    const isGlobal = this.globalCreateRoles.has(normalizedRole);
    const employeeContext = await this.resolveEmployeeContext(reqUser.employeeId, reqUser.role);
    const requestedDepartmentId = dto.departmentId ?? (typeof reqUser.departmentId === 'string' || typeof reqUser.departmentId === 'number'
      ? String(reqUser.departmentId)
      : null);
    const departmentId = requestedDepartmentId ?? employeeContext.departmentId ?? null;

    let resolvedAudience: AnnouncementAudience = isGlobal
      ? (dto.targetAudience ?? AnnouncementAudience.ALL)
      : (dto.targetAudience ?? AnnouncementAudience.DEPARTMENT);
    let resolvedTeamId: number | null = isGlobal && resolvedAudience === AnnouncementAudience.TEAM
      ? dto.teamId ?? null
      : null;

    if (this.teamManagerRoles.has(normalizedRole)) {
      resolvedAudience = AnnouncementAudience.TEAM;
      resolvedTeamId = employeeContext.teamId ?? (await this.resolveManagedTeamId(reqUser.employeeId));
      if (!resolvedTeamId) {
        throw new ForbiddenException('You are not assigned to a team that can publish announcements');
      }
    }

    if (isGlobal && dto.targetAudience === AnnouncementAudience.DEPARTMENT && departmentId === null) {
      throw new ForbiddenException('A department announcement must target a valid department');
    }

    if (resolvedAudience === AnnouncementAudience.TEAM && !resolvedTeamId) {
      throw new ForbiddenException('A team announcement must include a managed team');
    }

    if (resolvedAudience === AnnouncementAudience.DEPARTMENT && departmentId === null) {
      throw new ForbiddenException('A department announcement must target a valid department');
    }

    const created = await this.prisma.announcement.create({
      data: {
        title: dto.title,
        content: dto.content,
        category: dto.category,
        priority: dto.priority,
        targetAudience: resolvedAudience,
        departmentId:
          resolvedAudience === AnnouncementAudience.DEPARTMENT && departmentId !== null
            ? String(departmentId)
            : null,
        teamId: resolvedAudience === AnnouncementAudience.TEAM ? resolvedTeamId : null,
        isPinned: dto.isPinned,
        expiresAt: dto.expiresAt,
        createdById: reqUser.id,
      },
    });

    await this.notifyAnnouncementPublished({
      id: created.id,
      title: created.title,
      targetAudience: resolvedAudience,
      teamId: resolvedTeamId,
      departmentId:
        resolvedAudience === AnnouncementAudience.DEPARTMENT && departmentId !== null
          ? String(departmentId)
          : null,
    });

    return created;
  }

  async getAnnouncements(reqUser: { id?: number; role?: string; employeeId?: number | null; departmentId?: string | number | null }) {
    const normalizedRole = this.normalizeRole(reqUser?.role);
    const context = await this.resolveEmployeeContext(reqUser.employeeId, reqUser.role);
    const departmentId = reqUser.departmentId ?? context.departmentId ?? null;
    const employeeId = reqUser.employeeId ?? undefined;
    const teamId = context.teamId ?? (await this.resolveManagedTeamId(reqUser.employeeId));
    const now = new Date();

    const visibility: Prisma.AnnouncementWhereInput[] = [
      { targetAudience: AnnouncementAudience.ALL },
      ...(departmentId !== null && departmentId !== undefined
        ? [{ targetAudience: AnnouncementAudience.DEPARTMENT, departmentId: String(departmentId) }]
        : []),
      ...(teamId !== null && teamId !== undefined
        ? [{ targetAudience: AnnouncementAudience.TEAM, teamId }]
        : []),
    ];

    if (this.teamManagerRoles.has(normalizedRole)) {
      return this.prisma.announcement.findMany({
        where: {
          AND: [
            {
              OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
            },
            {
              OR: [
                { targetAudience: AnnouncementAudience.ALL },
                ...(departmentId !== null && departmentId !== undefined
                  ? [{ targetAudience: AnnouncementAudience.DEPARTMENT, departmentId: String(departmentId) }]
                  : []),
                { targetAudience: AnnouncementAudience.TEAM, teamId },
              ],
            },
          ],
        },
        include: {
          reads: employeeId ? { where: { employeeId } } : true,
        },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      });
    }

    if (normalizedRole === 'FINANCE_MANAGER') {
      return this.prisma.announcement.findMany({
        where: {
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }, { targetAudience: AnnouncementAudience.ALL }],
        },
        include: {
          reads: employeeId ? { where: { employeeId } } : true,
        },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      });
    }

    return this.prisma.announcement.findMany({
      where: {
        AND: [
          {
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          },
          {
            OR: visibility,
          },
        ],
      },
      include: {
        reads: employeeId ? { where: { employeeId } } : true,
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getAnnouncementById(id: number, reqUser: any) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      include: {
        reads: reqUser?.employeeId ? { where: { employeeId: reqUser.employeeId } } : true,
      },
    });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    await this.assertAnnouncementVisible(announcement, reqUser);

    return announcement;
  }

  async updateAnnouncement(id: number, dto: UpdateAnnouncementDto, reqUser: any) {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('Announcement not found');
    }

    await this.assertAnnouncementManageable(existing, reqUser);

    if (dto.targetAudience && dto.targetAudience !== existing.targetAudience) {
      if (this.normalizeRole(reqUser?.role) !== 'SUPER_ADMIN' && this.normalizeRole(reqUser?.role) !== 'CEO' && this.normalizeRole(reqUser?.role) !== 'HR') {
        const managedTeamId = await this.resolveManagedTeamId(reqUser?.employeeId);
        if (!managedTeamId || existing.teamId !== managedTeamId) {
          throw new ForbiddenException('You can only change the audience of your own team announcement');
        }
      }
    }

    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.targetAudience !== undefined && {
          targetAudience: dto.targetAudience,
        }),
        ...(dto.teamId !== undefined && {
          teamId: dto.teamId,
        }),
        ...(dto.isPinned !== undefined && { isPinned: dto.isPinned }),
        ...(dto.expiresAt !== undefined && { expiresAt: dto.expiresAt }),
      },
    });
  }

  async deleteAnnouncement(id: number, reqUser: any) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    await this.assertAnnouncementManageable(announcement, reqUser);

    try {
      return await this.prisma.announcement.delete({ where: { id } });
    } catch (error) {
      if (this.isPrismaNotFoundError(error)) {
        throw new NotFoundException('Announcement not found');
      }
      throw error;
    }
  }

  async markAsRead(announcementId: number, employeeId: number | null | undefined, reqUser?: any) {
    if (!employeeId) {
      throw new ForbiddenException('An employee profile is required to mark announcements as read');
    }

    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      select: {
        id: true,
        targetAudience: true,
        teamId: true,
        departmentId: true,
      },
    });
    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    await this.assertAnnouncementVisible(announcement, reqUser ?? { role: 'EMPLOYEE', employeeId });

    return this.prisma.announcementRead.upsert({
      where: { announcementId_employeeId: { announcementId, employeeId } },
      update: { readAt: new Date() },
      create: { announcementId, employeeId },
    });
  }

  async markAsUnread(announcementId: number, employeeId: number | null | undefined, reqUser?: any) {
    if (!employeeId) {
      throw new ForbiddenException('An employee profile is required to mark announcements as unread');
    }

    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      select: {
        id: true,
        targetAudience: true,
        teamId: true,
        departmentId: true,
      },
    });
    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    await this.assertAnnouncementVisible(announcement, reqUser ?? { role: 'EMPLOYEE', employeeId });

    return this.prisma.announcementRead.deleteMany({
      where: { announcementId, employeeId },
    });
  }

  private isPrismaNotFoundError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2025'
    );
  }
}
