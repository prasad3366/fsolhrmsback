import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

describe('Teams authorization regression coverage', () => {
  const team = (id: number, managerId: number) => ({
    id,
    name: `Team ${id}`,
    manager: { id: managerId, firstName: 'Team', lastName: 'Manager' },
    members: [{ id: 100 + id, firstName: 'Team', lastName: 'Member' }],
    createdAt: new Date('2026-01-01'),
  });

  const createService = () => {
    const repo = {
      findAll: jest.fn(),
      findByManager: jest.fn(),
      findById: jest.fn(),
      findManager: jest.fn(),
      createWithMembers: jest.fn(),
      addMembers: jest.fn().mockResolvedValue({ count: 1 }),
      removeMembers: jest.fn(),
      deleteTeam: jest.fn(),
    };
    const prisma = {
      team: {
        findUnique: jest.fn(),
      },
      employee: {
        findUnique: jest.fn(),
      },
    };

    return {
      service: new TeamService(repo as any, prisma as any),
      repo,
      prisma,
    };
  };

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('%s sees all persisted teams', async (role) => {
    const { service, repo } = createService();
    const teams = [team(1, 10), team(2, 20)];
    repo.findAll.mockResolvedValue(teams);

    await expect(service.getAllTeams({ role, employeeId: 999 })).resolves.toHaveLength(2);
    expect(repo.findAll).toHaveBeenCalledTimes(1);
    expect(repo.findByManager).not.toHaveBeenCalled();
  });

  it.each([
    ['IT_MANAGER', 10],
    ['SALES_MANAGER', 20],
  ])('%s sees only teams persisted against the authenticated manager', async (role, employeeId) => {
    const { service, repo } = createService();
    repo.findByManager.mockResolvedValue([team(1, employeeId)]);

    await expect(
      service.getAllTeams({ role, employeeId, teamId: 2, managerId: 999 }),
    ).resolves.toEqual([expect.objectContaining({ id: 1 })]);
    expect(repo.findByManager).toHaveBeenCalledWith(employeeId);
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER'])(
    '%s cannot manage another persisted team or its members',
    async (role) => {
      const { service, repo, prisma } = createService();
      prisma.team.findUnique.mockResolvedValue({ id: 2, managerId: 99 });

      await expect(
        service.addMembers(2, [101], {
          role,
          employeeId: 10,
          teamId: 2,
          managerId: 99,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.addMembers).not.toHaveBeenCalled();
    },
  );

  it.each(['EMPLOYEE', 'UNKNOWN'])('%s is denied team listing', async (role) => {
    const { service, repo } = createService();

    await expect(service.getAllTeams({ role, employeeId: 10 })).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.findAll).not.toHaveBeenCalled();
    expect(repo.findByManager).not.toHaveBeenCalled();
  });

  it('returns only the authenticated employee team', async () => {
    const { service, prisma, repo } = createService();
    const ownTeam = team(7, 10);
    prisma.employee.findUnique.mockResolvedValue({ id: 25, team: ownTeam });

    await expect(service.getMyTeam(25, { role: 'EMPLOYEE', employeeId: 25 })).resolves.toEqual([
      expect.objectContaining({ id: ownTeam.id }),
    ]);
    expect(prisma.employee.findUnique).toHaveBeenCalledWith({
      where: { id: 25 },
      include: {
        team: {
          include: {
            manager: true,
            members: true,
          },
        },
      },
    });
    expect(repo.findAll).not.toHaveBeenCalled();
    expect(repo.findByManager).not.toHaveBeenCalled();
  });

  it('returns no team when the authenticated employee has no team', async () => {
    const { service, prisma } = createService();
    prisma.employee.findUnique.mockResolvedValue({ id: 25, team: null });

    await expect(service.getMyTeam(25, { role: 'EMPLOYEE', employeeId: 25 })).resolves.toEqual([]);
  });

  it('prevents an employee from resolving another employee team', async () => {
    const { service, prisma } = createService();

    await expect(service.getMyTeam(99, { role: 'EMPLOYEE', employeeId: 25 })).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when the user or role is missing', async () => {
    const { service } = createService();

    await expect(service.getAllTeams(undefined)).rejects.toThrow(UnauthorizedException);
    await expect(service.getAllTeams({ employeeId: 10 })).rejects.toThrow(ForbiddenException);
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('%s may create and delete teams', async (role) => {
    const { service, repo } = createService();
    const created = { id: 3 };
    repo.findManager.mockResolvedValue({ id: 30, user: { role: 'IT_MANAGER' } });
    repo.createWithMembers.mockResolvedValue(created);
    repo.findById.mockResolvedValue(team(3, 30));

    await expect(
      service.createTeam({ name: 'New Team', managerId: 'M30' }, { role }),
    ).resolves.toEqual(team(3, 30));
    await expect(service.deleteTeam(3, { role })).resolves.toEqual({
      message: 'Team deleted successfully',
    });
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER', 'EMPLOYEE', 'UNKNOWN'])(
    '%s cannot create or delete teams',
    async (role) => {
      const { service, repo } = createService();

      await expect(
        service.createTeam({ name: 'New Team', managerId: 'M30' }, { role }),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.deleteTeam(3, { role })).rejects.toThrow(ForbiddenException);
      expect(repo.findManager).not.toHaveBeenCalled();
      expect(repo.deleteTeam).not.toHaveBeenCalled();
    },
  );

  it('controller management role metadata excludes non-admin roles', () => {
    const createRoles = Reflect.getMetadata('roles', TeamController.prototype.createTeam);
    const deleteRoles = Reflect.getMetadata('roles', TeamController.prototype.deleteTeam);
    const selfViewRoles = Reflect.getMetadata('roles', TeamController.prototype.getMyTeam);

    expect(createRoles).toEqual(['SUPER_ADMIN', 'CEO', 'HR']);
    expect(deleteRoles).toEqual(['SUPER_ADMIN', 'CEO', 'HR']);
    expect(createRoles).not.toContain('FINANCE_MANAGER');
    expect(createRoles).not.toContain('EMPLOYEE');
    expect(selfViewRoles).toContain('EMPLOYEE');
    expect(selfViewRoles).toContain('IT_MANAGER');
    expect(selfViewRoles).toContain('SALES_MANAGER');
    expect(selfViewRoles).toContain('FINANCE_MANAGER');
  });
});