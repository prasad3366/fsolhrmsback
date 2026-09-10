import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';

describe('AnnouncementService authorization', () => {
  const prisma = {
    employee: {
      findUnique: jest.fn(),
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
    },
  } as any;
  let service: AnnouncementService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnnouncementService(prisma);
    prisma.announcement.findMany.mockResolvedValue([]);
  });

  it('creates global announcements for SUPER_ADMIN/CEO/HR and ignores any client team selection', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 11 });
    prisma.announcement.create.mockResolvedValue({ id: 1 });

    await service.createAnnouncement(
      { title: 'All hands', content: 'Company update', targetAudience: 'TEAM', teamId: 99 } as any,
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

  it('creates team announcements for IT_MANAGER using the authenticated managed team only', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 12 });
    prisma.team.findFirst.mockResolvedValue({ id: 12, managerId: 7, name: 'IT' });
    prisma.announcement.create.mockResolvedValue({ id: 2 });

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

  it('returns manager team announcements and global announcements to a team manager', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 12 });
    prisma.team.findFirst.mockResolvedValue({ id: 12, managerId: 7, name: 'IT' });

    await service.getAnnouncements({ id: 7, role: 'IT_MANAGER', employeeId: 7 });

    const query = prisma.announcement.findMany.mock.calls[0][0];
    expect(query.where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ OR: [{ expiresAt: null }, { expiresAt: { gte: expect.any(Date) } }] }),
      expect.objectContaining({ OR: [
        { targetAudience: 'ALL' },
        { targetAudience: 'TEAM', teamId: 12 },
      ] }),
    ]));
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
