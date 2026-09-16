import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationEntityType } from '@prisma/client';
import { AnnouncementService } from './announcement.service';

describe('AnnouncementService authorization', () => {
  const notificationService = {
    createNotification: jest.fn(),
    createActionItem: jest.fn(),
  } as any;

  const prisma = {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    team: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    announcement: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    announcementRead: {
      createMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  } as any;
  let service: AnnouncementService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnnouncementService(prisma, notificationService);
    prisma.announcement.findMany.mockResolvedValue([]);
  });

  it('creates global announcements for SUPER_ADMIN/CEO/HR and ignores a team id for ALL', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 11 });
    prisma.user.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.announcement.create.mockResolvedValue({ id: 1, title: 'All hands', targetAudience: 'ALL' });

    await service.createAnnouncement(
      { title: 'All hands', content: 'Company update', targetAudience: 'ALL', teamId: 99 } as any,
      { id: 9, role: 'SUPER_ADMIN', employeeId: 7 },
    );

    expect(prisma.announcement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetAudience: 'ALL',
        teamId: null,
        createdById: 9,
      }),
    });
  });

  it('keeps the selected team for management TEAM announcements', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 11 });
    prisma.team.findUnique.mockResolvedValue({ id: 99 });
    prisma.employee.findMany.mockResolvedValue([]);
    prisma.announcement.create.mockResolvedValue({ id: 3, title: 'Team update', targetAudience: 'TEAM', teamId: 99 });

    await service.createAnnouncement(
      { title: 'Team update', content: 'Team note', targetAudience: 'TEAM', teamId: 99 } as any,
      { id: 9, role: 'CEO', employeeId: 7 },
    );

    expect(prisma.announcement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetAudience: 'TEAM', teamId: 99 }),
    });
  });

  it('creates team announcements for IT_MANAGER using the authenticated managed team only', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 12 });
    prisma.team.findFirst.mockResolvedValue({ id: 12, managerId: 7, name: 'IT' });
    prisma.employee.findMany.mockResolvedValue([{ userId: 10 }, { userId: 11 }]);
    prisma.announcement.create.mockResolvedValue({ id: 2, title: 'IT update', targetAudience: 'TEAM' });

    await service.createAnnouncement(
      { title: 'IT update', content: 'Patch rollout', teamId: 99 } as any,
      { id: 11, role: 'IT_MANAGER', employeeId: 7 },
    );

    expect(prisma.team.findFirst).toHaveBeenCalledWith({ where: { managerId: 7 } });
    expect(prisma.announcement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetAudience: 'TEAM',
        teamId: 12,
        createdById: 11,
      }),
    });
  });

  it('publishes a global announcement to eligible active users and creates informational notifications', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 11, department: 'Engineering' });
    prisma.announcement.create.mockResolvedValue({ id: 101, title: 'All hands', targetAudience: 'ALL' });
    prisma.user.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);

    await service.createAnnouncement(
      { title: 'All hands', content: 'Company update', targetAudience: 'ALL' } as any,
      { id: 9, role: 'SUPER_ADMIN', employeeId: 7 },
    );

    expect(notificationService.createNotification).toHaveBeenCalledTimes(3);
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      entityType: NotificationEntityType.ANNOUNCEMENT,
      entityId: 101,
      title: expect.stringContaining('New announcement'),
      message: expect.stringContaining('All hands'),
    }));
    expect(notificationService.createActionItem).not.toHaveBeenCalled();
  });

  it('publishes a team announcement only to users in the targeted team', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 12, department: 'IT' });
    prisma.team.findFirst.mockResolvedValue({ id: 12, managerId: 7, name: 'IT' });
    prisma.announcement.create.mockResolvedValue({ id: 102, title: 'IT update', targetAudience: 'TEAM', teamId: 12 });
    prisma.employee.findMany.mockResolvedValue([
      { userId: 10 },
      { userId: 11 },
      { userId: 12 },
      { userId: 99 },
    ]);

    await service.createAnnouncement(
      { title: 'IT update', content: 'Patch rollout', targetAudience: 'TEAM' } as any,
      { id: 11, role: 'IT_MANAGER', employeeId: 7 },
    );

    expect(prisma.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ teamId: 12 }),
    }));
    expect(notificationService.createNotification.mock.calls.map((call) => call[0].recipientUserId)).toEqual([10, 11, 12, 99]);
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      entityType: NotificationEntityType.ANNOUNCEMENT,
      entityId: 102,
    }));
    expect(notificationService.createActionItem).not.toHaveBeenCalled();
  });

  it('does not create notifications when an announcement is only read/viewed', async () => {
    prisma.announcement.findUnique.mockResolvedValue({
      id: 42,
      targetAudience: 'ALL',
      expiresAt: null,
    });
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 12, department: 'IT' });

    await service.markAsRead(42, 7, { id: 7, role: 'EMPLOYEE', employeeId: 7 });

    expect(notificationService.createNotification).not.toHaveBeenCalled();
  });

  it('blocks finance managers from creating announcements', async () => {
    await expect(
      service.createAnnouncement(
        { title: 'Finance update', content: 'Budget note' },
        { id: 20, role: 'FINANCE_MANAGER', employeeId: 13 },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('limits list results to global announcements for FINANCE_MANAGER', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 13, teamId: 14 });
    prisma.announcement.findMany.mockResolvedValue([]);

    await service.getAnnouncements({ id: 13, role: 'FINANCE_MANAGER', employeeId: 13 });

    const query = prisma.announcement.findMany.mock.calls[0][0];
    expect(query.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ OR: [{ expiresAt: null }, { expiresAt: { gte: expect.any(Date) } }] }),
        { targetAudience: 'ALL' },
      ]),
    );
  });

  it('returns manager team announcements, global announcements, and same-department announcements to a team manager', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 12, department: 'Engineering' });
    prisma.team.findFirst.mockResolvedValue({ id: 12, managerId: 7, name: 'IT' });

    await service.getAnnouncements({ id: 7, role: 'IT_MANAGER', employeeId: 7 });

    const query = prisma.announcement.findMany.mock.calls[0][0];
    expect(query.where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ OR: [{ expiresAt: null }, { expiresAt: { gte: expect.any(Date) } }] }),
      expect.objectContaining({ OR: [
        { targetAudience: 'ALL' },
        { targetAudience: 'DEPARTMENT', departmentId: 'Engineering' },
        { targetAudience: 'TEAM', teamId: 12 },
      ] }),
    ]));
  });

  it('persists read state and removes it when an employee marks an announcement unread', async () => {
    prisma.announcement.findUnique.mockResolvedValue({
      id: 42,
      targetAudience: 'ALL',
      expiresAt: null,
    });
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 12, department: 'Engineering' });
    prisma.announcementRead.upsert.mockResolvedValue({ id: 1, announcementId: 42, employeeId: 7 });
    prisma.announcementRead.deleteMany.mockResolvedValue({ count: 1 });

    await service.markAsRead(42, 7, { id: 7, role: 'EMPLOYEE', employeeId: 7 });
    await service.markAsUnread(42, 7, { id: 7, role: 'EMPLOYEE', employeeId: 7 });

    expect(prisma.announcementRead.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { announcementId_employeeId: { announcementId: 42, employeeId: 7 } },
      create: { announcementId: 42, employeeId: 7 },
    }));
    expect(prisma.announcementRead.deleteMany).toHaveBeenCalledWith({
      where: { announcementId: 42, employeeId: 7 },
    });
  });

  it('blocks marking an unauthorized announcement as read by ID', async () => {
    prisma.announcement.findUnique.mockResolvedValue({
      id: 42,
      targetAudience: 'TEAM',
      teamId: 99,
      expiresAt: null,
    });
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 12 });

    await expect(service.markAsRead(42, 7, { id: 7, role: 'EMPLOYEE', employeeId: 7 })).rejects.toThrow(ForbiddenException);
  });

  it('blocks update requests for another manager team announcement', async () => {
    prisma.announcement.findUnique.mockResolvedValue({
      id: 5,
      createdById: 11,
      targetAudience: 'TEAM',
      teamId: 12,
      expiresAt: null,
    });
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 7 });
    prisma.team.findFirst.mockResolvedValue({ id: 7, managerId: 7, name: 'IT' });

    await expect(
      service.updateAnnouncement(5, { title: 'bad' } as any, { id: 7, role: 'IT_MANAGER', employeeId: 7 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('blocks a manager from updating a global announcement', async () => {
    prisma.announcement.findUnique.mockResolvedValue({
      id: 9,
      createdById: 1,
      targetAudience: 'ALL',
      teamId: null,
      expiresAt: null,
    });
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 12 });
    prisma.team.findFirst.mockResolvedValue({ id: 12, managerId: 7, name: 'IT' });

    await expect(
      service.updateAnnouncement(9, { title: 'tampered' } as any, { id: 7, role: 'IT_MANAGER', employeeId: 7 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws not found when reading a missing announcement', async () => {
    prisma.announcement.findUnique.mockResolvedValue(null);

    await expect(service.markAsRead(999, 7, { id: 7, role: 'EMPLOYEE', employeeId: 7 })).rejects.toThrow(NotFoundException);
  });
});
