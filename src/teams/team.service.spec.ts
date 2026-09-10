import { BadRequestException } from '@nestjs/common';
import { TeamService } from './team.service';

describe('TeamService member validation', () => {
  let repo: any;
  let prisma: any;
  let service: TeamService;

  beforeEach(() => {
    repo = {
      addMembers: jest.fn(),
      removeMembers: jest.fn(),
      findById: jest.fn(),
      findByManager: jest.fn(),
      findManager: jest.fn(),
      createWithMembers: jest.fn(),
    };

    prisma = {};
    service = new TeamService(repo, prisma);
  });

  it('accepts a valid employee ID list', async () => {
    repo.addMembers.mockResolvedValue({ count: 2 });
    repo.findById.mockResolvedValue({ id: 1, name: 'IT', manager: {}, members: [] });

    await expect(service.addMembers(1, [10, 11], { role: 'HR' })).resolves.toEqual({
      id: 1,
      name: 'IT',
      manager: {},
      members: [],
    });
  });

  it('rejects a non-integer employee ID', async () => {
    await expect(service.addMembers(1, [10, 11.5], { role: 'HR' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a zero employee ID', async () => {
    await expect(service.addMembers(1, [0], { role: 'HR' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a negative employee ID', async () => {
    await expect(service.addMembers(1, [-3], { role: 'HR' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects NaN and non-numeric employee IDs', async () => {
    await expect(service.addMembers(1, [Number.NaN], { role: 'HR' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.addMembers(1, [Number.POSITIVE_INFINITY], { role: 'HR' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.addMembers(1, ['abc' as any], { role: 'HR' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects mixed valid and invalid IDs without processing any members', async () => {
    await expect(service.addMembers(1, [10, -1], { role: 'HR' })).rejects.toThrow(
      BadRequestException,
    );
    expect(repo.addMembers).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: '', managerId: 'IT001' }, 'Team name'],
    [{ name: '   ', managerId: 'IT001' }, 'Team name'],
    [{ name: 'IT Team', managerId: '' }, 'managerId'],
    [{ name: 'IT Team', managerId: '   ' }, 'managerId'],
  ])('rejects invalid create-team input for %s', async (dto, field) => {
    await expect(service.createTeam(dto, { role: 'CEO' })).rejects.toThrow(BadRequestException);
    expect(repo.findManager).not.toHaveBeenCalled();
    expect(field).toBeDefined();
  });

  it('preserves valid create-team behavior', async () => {
    const createdTeam = { id: 7 };
    const persistedTeam = { id: 7, name: 'IT Team', manager: {}, members: [] };
    repo.findManager.mockResolvedValue({ id: 3, user: { role: 'IT_MANAGER' } });
    repo.createWithMembers.mockResolvedValue(createdTeam);
    repo.findById.mockResolvedValue(persistedTeam);

    await expect(
      service.createTeam(
        { name: 'IT Team', managerId: 'IT001', employeeIds: [10] },
        { role: 'CEO' },
      ),
    ).resolves.toEqual(persistedTeam);
    expect(repo.findManager).toHaveBeenCalledWith('IT001');
    expect(repo.createWithMembers).toHaveBeenCalledWith(
      { name: 'IT Team', managerId: 3 },
      [10],
    );
  });
});
