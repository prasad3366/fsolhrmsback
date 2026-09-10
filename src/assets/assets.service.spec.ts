import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AssetsService } from './assets.service';

describe('AssetsService Employee 360 asset summary', () => {
  const employeeFindUnique = jest.fn();
  const userFindUnique = jest.fn();
  const assetCreate = jest.fn();
  const assetUpdateMany = jest.fn();
  const assetFindUnique = jest.fn();
  const assetFindMany = jest.fn();
  const assetAssignmentUpdateMany = jest.fn();
  const assetAssignmentCreate = jest.fn();
  const prisma = {
    $transaction: jest.fn((callback) => callback(prisma)),
    employee: { findUnique: employeeFindUnique },
    user: { findUnique: userFindUnique },
    asset: {
      create: assetCreate,
      updateMany: assetUpdateMany,
      findUnique: assetFindUnique,
      findMany: assetFindMany,
    },
    assetAssignment: {
      updateMany: assetAssignmentUpdateMany,
      create: assetAssignmentCreate,
    },
  } as any;
  const authorizationService = { canAccessEmployee: jest.fn() } as any;
  const service = new AssetsService(prisma, authorizationService);

  beforeEach(() => {
    jest.clearAllMocks();
    userFindUnique.mockResolvedValue({ id: 900 });
    assetCreate.mockResolvedValue({ id: 12, name: 'Laptop', assignedTo: 900 });
    assetUpdateMany.mockResolvedValue({ count: 1 });
    assetAssignmentUpdateMany.mockResolvedValue({ count: 1 });
    assetAssignmentCreate.mockResolvedValue({ id: 40 });
    assetFindUnique.mockResolvedValue({
      id: 12,
      name: 'Laptop',
      status: 'AVAILABLE',
      assignedTo: null,
      assignedAt: null,
      returnedAt: new Date('2026-09-05T10:00:00Z'),
    });
    authorizationService.canAccessEmployee.mockResolvedValue(true);
    employeeFindUnique.mockResolvedValue({ userId: 900 });
    assetFindMany.mockResolvedValue([
      {
        id: 12,
        name: 'Laptop',
        description: 'Company laptop',
        assignedAt: new Date('2026-09-01'),
        status: 'ASSIGNED',
      },
    ]);
  });

  it('resolves Employee.userId before querying assets for an EMPLOYEE', async () => {
    const user = { id: 900, role: 'EMPLOYEE', employeeId: 7 };

    await expect(service.findEmployee360Assets(user, 7)).resolves.toEqual([
      expect.objectContaining({ id: 12, name: 'Laptop', status: 'ASSIGNED' }),
    ]);

    expect(employeeFindUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { userId: true },
    });
    expect(assetFindMany).toHaveBeenCalledWith({
      where: { assignedTo: 900 },
      select: {
        id: true,
        name: true,
        description: true,
        assignedAt: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(assetFindMany.mock.calls[0][0].where.assignedTo).not.toBe(7);
  });

  it('denies an EMPLOYEE access to another employee assets before querying', async () => {
    await expect(
      service.findEmployee360Assets({ id: 1, role: 'EMPLOYEE', employeeId: 7 }, 8),
    ).rejects.toThrow(ForbiddenException);
    expect(employeeFindUnique).toHaveBeenCalled();
    expect(assetFindMany).not.toHaveBeenCalled();
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'])('denies %s another user assets', async (role) => {
    await expect(
      service.findEmployee360Assets({ id: 1, role, employeeId: 4 }, 7),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s organization-wide access', async (role) => {
    await expect(
      service.findEmployee360Assets({ id: 1, role }, 7),
    ).resolves.toHaveLength(1);
  });

  it('does not trust client-supplied team or manager identifiers', async () => {
    const user = {
      id: 1,
      role: 'IT_MANAGER',
      employeeId: 4,
      teamId: 999,
      managerId: 999,
    } as any;

    await expect(service.findEmployee360Assets(user, 7)).rejects.toThrow(ForbiddenException);

    expect(employeeFindUnique.mock.calls[0][0].where).toEqual({ id: 7 });
  });

  it('returns no assets when the target employee record is missing', async () => {
    employeeFindUnique.mockResolvedValue(null);

    await expect(
      service.findEmployee360Assets({ id: 1, role: 'HR' }, 7),
    ).resolves.toEqual([]);
    expect(assetFindMany).not.toHaveBeenCalled();
  });

  it('keeps existing findMyAssets behavior unchanged', async () => {
    await service.findMyAssets(900);

    expect(assetFindMany).toHaveBeenCalledWith({
      where: { assignedTo: 900 },
      include: { user: { include: { employee: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('creates an asset for a valid assigned User.id', async () => {
    await expect(
      service.create({ name: 'Laptop', assignedTo: 900 }),
    ).resolves.toEqual({ id: 12, name: 'Laptop', assignedTo: 900 });

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: 900 },
      select: { id: true },
    });
    expect(assetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignedTo: 900,
        assignedAt: expect.any(Date),
        status: 'ASSIGNED',
      }),
    });
  });

  it('explicitly preserves ASSIGNED status for assigned creation', async () => {
    assetCreate.mockResolvedValueOnce({
      id: 12,
      name: 'Laptop',
      assignedTo: 900,
      status: 'ASSIGNED',
    });

    await expect(service.create({ name: 'Laptop', assignedTo: 900 })).resolves.toEqual(
      expect.objectContaining({ assignedTo: 900, status: 'ASSIGNED' }),
    );

    expect(assetCreate.mock.calls[0][0].data.status).toBe('ASSIGNED');
  });

  it.each(['', '   ', '\t\n'])('rejects an invalid asset name: %j', async (name) => {
    await expect(service.create({ name })).rejects.toThrow(BadRequestException);
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(assetCreate).not.toHaveBeenCalled();
  });

  it.each([null, 123, {}, []])('rejects a non-string asset name: %j', async (name) => {
    await expect(service.create({ name } as any)).rejects.toThrow(BadRequestException);
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(assetCreate).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent assigned User.id before asset creation', async () => {
    userFindUnique.mockResolvedValue(null);

    await expect(service.create({ name: 'Laptop', assignedTo: 901 })).rejects.toThrow(
      'Assigned user not found',
    );
    expect(assetCreate).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid assignedTo value %s',
    async (assignedTo) => {
      await expect(service.create({ name: 'Laptop', assignedTo } as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(userFindUnique).not.toHaveBeenCalled();
      expect(assetCreate).not.toHaveBeenCalled();
    },
  );

  it('creates an unassigned asset as AVAILABLE', async () => {
    assetCreate.mockResolvedValueOnce({
      id: 12,
      name: 'Laptop',
      description: 'Company laptop',
      assignedTo: null,
      assignedAt: null,
      status: 'AVAILABLE',
    });

    await expect(
      service.create({ name: 'Laptop', description: 'Company laptop' }),
    ).resolves.toEqual(
      expect.objectContaining({
        name: 'Laptop',
        description: 'Company laptop',
        assignedTo: null,
        assignedAt: null,
        status: 'AVAILABLE',
      }),
    );

    expect(userFindUnique).not.toHaveBeenCalled();
    expect(assetCreate).toHaveBeenCalledWith({
      data: {
        name: 'Laptop',
        description: 'Company laptop',
        assignedTo: undefined,
        assignedAt: null,
        status: 'AVAILABLE',
      },
    });
  });

  it('returns an asset by clearing assignment and recording the return', async () => {
    await expect(service.returnAsset(12)).resolves.toEqual(
      expect.objectContaining({
        id: 12,
        status: 'AVAILABLE',
        assignedTo: null,
        assignedAt: null,
        returnedAt: expect.any(Date),
      }),
    );

    expect(assetUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 12,
        status: 'ASSIGNED',
        assignedTo: { not: null },
      },
      data: {
        status: 'AVAILABLE',
        returnedAt: expect.any(Date),
        assignedTo: null,
        assignedAt: null,
      },
    });
    expect(assetFindUnique).toHaveBeenCalledWith({
      where: { id: 12 },
      include: {
        user: {
          include: {
            employee: true,
          },
        },
      },
    });
    expect(assetAssignmentUpdateMany).toHaveBeenCalledWith({
      where: { assetId: 12, unassignedAt: null },
      data: { unassignedAt: expect.any(Date) },
    });
  });

  it.each([
    ['AVAILABLE', { id: 12 }],
    ['RETURNED', { id: 12 }],
  ])('rejects returning an already %s asset without mutation', async (status, asset) => {
    assetUpdateMany.mockResolvedValueOnce({ count: 0 });
    assetFindUnique.mockResolvedValueOnce({ ...asset, status });

    await expect(service.returnAsset(12)).rejects.toThrow(BadRequestException);
    expect(assetUpdateMany).toHaveBeenCalledTimes(1);
    expect(assetFindUnique).toHaveBeenCalledWith({
      where: { id: 12 },
      select: { id: true },
    });
  });

  it('rejects returning a missing asset with not-found behavior', async () => {
    assetUpdateMany.mockResolvedValueOnce({ count: 0 });
    assetFindUnique.mockResolvedValueOnce(null);

    await expect(service.returnAsset(999)).rejects.toThrow(NotFoundException);
    expect(assetUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('allows only one of two concurrent return transitions to succeed', async () => {
    assetUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    assetFindUnique.mockResolvedValueOnce({
      id: 12,
      status: 'AVAILABLE',
      assignedTo: null,
      assignedAt: null,
      returnedAt: new Date('2026-09-05T10:00:00Z'),
    });

    const results = await Promise.allSettled([
      service.returnAsset(12),
      service.returnAsset(12),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(assetUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('keeps returned assets visible in all-assets history', async () => {
    const returnedAsset = {
      id: 12,
      name: 'Laptop',
      assignedTo: null,
      assignedAt: null,
      returnedAt: new Date('2026-09-05T10:00:00Z'),
      status: 'RETURNED',
    };
    assetFindMany.mockResolvedValueOnce([returnedAsset]);

    await expect(service.findAll()).resolves.toEqual([returnedAsset]);
    expect(assetFindMany).toHaveBeenCalledWith({
      include: { user: { include: { employee: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('keeps returned assets visible in Employee 360 history', async () => {
    const returnedAsset = {
      id: 12,
      name: 'Laptop',
      description: 'Company laptop',
      assignedAt: null,
      status: 'RETURNED',
    };
    assetFindMany.mockResolvedValueOnce([returnedAsset]);

    await expect(
      service.findEmployee360Assets({ id: 1, role: 'HR' }, 7),
    ).resolves.toEqual([returnedAsset]);
  });
});