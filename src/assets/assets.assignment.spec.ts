import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssetsService } from './assets.service';

describe('AssetsService assignment lifecycle', () => {
  const employeeFindUnique = jest.fn();
  const assetFindUnique = jest.fn();
  const assetUpdateMany = jest.fn();
  const assetAssignmentUpdateMany = jest.fn();
  const assetAssignmentCreate = jest.fn();
  const prisma = {
    $transaction: jest.fn((callback) => callback(prisma)),
    employee: { findUnique: employeeFindUnique },
    asset: { findUnique: assetFindUnique, updateMany: assetUpdateMany },
    assetAssignment: {
      updateMany: assetAssignmentUpdateMany,
      create: assetAssignmentCreate,
    },
  } as any;
  const authorizationService = {} as any;
  const service = new AssetsService(prisma, authorizationService);

  beforeEach(() => {
    jest.clearAllMocks();
    employeeFindUnique.mockResolvedValue({ id: 7, userId: 700 });
    assetUpdateMany.mockResolvedValue({ count: 1 });
    assetAssignmentUpdateMany.mockResolvedValue({ count: 1 });
    assetAssignmentCreate.mockResolvedValue({ id: 100 });
  });

  it('assigns an AVAILABLE asset to the employee User.id', async () => {
    const assignedAsset = {
      id: 12,
      name: 'Laptop',
      status: 'ASSIGNED',
      assignedTo: 700,
      assignedAt: new Date('2026-09-05T10:00:00Z'),
      returnedAt: null,
    };
    assetFindUnique
      .mockResolvedValueOnce({ id: 12, status: 'AVAILABLE', assignedTo: null })
      .mockResolvedValueOnce(assignedAsset);

    await expect(service.assignAsset({ assetId: 12, employeeId: 7 })).resolves.toEqual(
      assignedAsset,
    );

    expect(assetUpdateMany).toHaveBeenCalledWith({
      where: { id: 12, status: 'AVAILABLE', assignedTo: null },
      data: {
        status: 'ASSIGNED',
        assignedTo: 700,
        assignedAt: expect.any(Date),
        returnedAt: null,
      },
    });
    expect(assetAssignmentCreate).toHaveBeenCalledWith({
      data: {
        assetId: 12,
        assignedTo: 700,
        assignedAt: expect.any(Date),
      },
    });
    expect(assetAssignmentUpdateMany).not.toHaveBeenCalled();
  });

  it('reassigns an ASSIGNED asset while closing the previous history row', async () => {
    const reassignedAsset = {
      id: 12,
      name: 'Laptop',
      status: 'ASSIGNED',
      assignedTo: 701,
      assignedAt: new Date('2026-09-05T10:00:00Z'),
      returnedAt: null,
    };
    employeeFindUnique.mockResolvedValueOnce({ id: 8, userId: 701 });
    assetFindUnique
      .mockResolvedValueOnce({ id: 12, status: 'ASSIGNED', assignedTo: 700 })
      .mockResolvedValueOnce(reassignedAsset);

    await expect(service.assignAsset({ assetId: 12, employeeId: 8 })).resolves.toEqual(
      reassignedAsset,
    );

    expect(assetUpdateMany).toHaveBeenCalledWith({
      where: { id: 12, status: 'ASSIGNED', assignedTo: 700 },
      data: expect.objectContaining({ status: 'ASSIGNED', assignedTo: 701 }),
    });
    expect(assetAssignmentUpdateMany).toHaveBeenCalledWith({
      where: { assetId: 12, unassignedAt: null },
      data: { unassignedAt: expect.any(Date) },
    });
    expect(assetAssignmentCreate).toHaveBeenCalledWith({
      data: {
        assetId: 12,
        assignedTo: 701,
        assignedAt: expect.any(Date),
      },
    });
  });

  it('rejects assigning an already assigned asset to the same employee', async () => {
    assetFindUnique.mockResolvedValueOnce({ id: 12, status: 'ASSIGNED', assignedTo: 700 });

    await expect(service.assignAsset({ assetId: 12, employeeId: 7 })).rejects.toThrow(
      BadRequestException,
    );
    expect(assetUpdateMany).not.toHaveBeenCalled();
    expect(assetAssignmentUpdateMany).not.toHaveBeenCalled();
    expect(assetAssignmentCreate).not.toHaveBeenCalled();
  });

  it('rejects legacy RETURNED assets without mutation', async () => {
    assetFindUnique.mockResolvedValueOnce({ id: 12, status: 'RETURNED', assignedTo: null });

    await expect(service.assignAsset({ assetId: 12, employeeId: 7 })).rejects.toThrow(
      BadRequestException,
    );
    expect(assetUpdateMany).not.toHaveBeenCalled();
    expect(assetAssignmentCreate).not.toHaveBeenCalled();
  });

  it('preserves not-found behavior for a missing asset', async () => {
    assetFindUnique.mockResolvedValueOnce(null);

    await expect(service.assignAsset({ assetId: 999, employeeId: 7 })).rejects.toThrow(
      NotFoundException,
    );
    expect(assetUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid employee before mutating the asset', async () => {
    employeeFindUnique.mockResolvedValueOnce(null);

    await expect(service.assignAsset({ assetId: 12, employeeId: 999 })).rejects.toThrow(
      NotFoundException,
    );
    expect(assetFindUnique).not.toHaveBeenCalled();
    expect(assetUpdateMany).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent assignments to win the asset transition', async () => {
    employeeFindUnique.mockResolvedValue({ id: 7, userId: 700 });
    assetFindUnique.mockResolvedValue({ id: 12, status: 'AVAILABLE', assignedTo: null });
    assetUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const results = await Promise.allSettled([
      service.assignAsset({ assetId: 12, employeeId: 7 }),
      service.assignAsset({ assetId: 12, employeeId: 8 }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(assetUpdateMany).toHaveBeenCalledTimes(2);
    expect(assetAssignmentCreate).toHaveBeenCalledTimes(1);
  });
});