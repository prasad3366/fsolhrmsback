import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HelpdeskService } from './helpdesk.service';

describe('HelpdeskService management authorization', () => {
  const ticketFindUnique = jest.fn();
  const ticketUpdateMany = jest.fn();
  const ticketCreate = jest.fn();
  const userFindUnique = jest.fn();
  const prisma = {
    user: { findUnique: userFindUnique },
    helpdeskTicket: {
      findUnique: ticketFindUnique,
      updateMany: ticketUpdateMany,
      create: ticketCreate,
    },
  } as any;
  const authorizationService = {
    canAccessOrganizationWide: jest.fn(),
  } as any;
  const service = new HelpdeskService(prisma, authorizationService);

  beforeEach(() => {
    jest.clearAllMocks();
    ticketFindUnique.mockResolvedValue({ id: 12, status: 'PENDING' });
    ticketUpdateMany.mockResolvedValue({ count: 1 });
    userFindUnique.mockResolvedValue({ id: 1, employee: { id: 7 } });
    ticketCreate.mockResolvedValue({ id: 12, issue: 'Laptop', reason: 'Broken' });
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s to approve and resolve', async (role) => {
    authorizationService.canAccessOrganizationWide.mockReturnValue(true);
    const actor = { id: 1, role };

    ticketFindUnique.mockResolvedValueOnce({ id: 12, status: 'APPROVED' });
    await expect(service.approve(12, actor)).resolves.toEqual({ id: 12, status: 'APPROVED' });
    ticketFindUnique.mockResolvedValue({ id: 12, status: 'APPROVED' });
    ticketUpdateMany.mockResolvedValue({ count: 1 });
    ticketFindUnique.mockResolvedValueOnce({ id: 12, status: 'RESOLVED' });
    await expect(service.resolve(12, actor)).resolves.toEqual({ id: 12, status: 'RESOLVED' });

    expect(authorizationService.canAccessOrganizationWide).toHaveBeenCalledWith(actor, 'helpdesk');
  });

  it.each(['FINANCE_MANAGER', 'IT_MANAGER', 'SALES_MANAGER', 'EMPLOYEE', 'UNKNOWN'])(
    'denies %s before reading or mutating the ticket',
    async (role) => {
      authorizationService.canAccessOrganizationWide.mockReturnValue(false);

      await expect(service.approve(12, { id: 1, role })).rejects.toThrow(ForbiddenException);
      await expect(service.resolve(12, { id: 1, role })).rejects.toThrow(ForbiddenException);

      expect(ticketFindUnique).not.toHaveBeenCalled();
      expect(ticketUpdateMany).not.toHaveBeenCalled();
    },
  );

  it('denies a missing actor before reading or mutating the ticket', async () => {
    authorizationService.canAccessOrganizationWide.mockReturnValue(false);

    await expect(service.approve(12, undefined)).rejects.toThrow(ForbiddenException);
    await expect(service.resolve(12, undefined)).rejects.toThrow(ForbiddenException);

    expect(ticketFindUnique).not.toHaveBeenCalled();
    expect(ticketUpdateMany).not.toHaveBeenCalled();
  });

  it('preserves lifecycle validation after authorization', async () => {
    authorizationService.canAccessOrganizationWide.mockReturnValue(true);
    ticketFindUnique.mockResolvedValue({ id: 12, status: 'RESOLVED' });
    ticketUpdateMany.mockResolvedValue({ count: 0 });

    await expect(service.approve(12, { id: 1, role: 'HR' })).rejects.toThrow(BadRequestException);
    expect(ticketUpdateMany).toHaveBeenCalledWith({
      where: { id: 12, status: 'PENDING' },
      data: { status: 'APPROVED' },
    });
  });

  it('allows PENDING to become APPROVED and rejects a second approval', async () => {
    authorizationService.canAccessOrganizationWide.mockReturnValue(true);
    ticketUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    ticketFindUnique
      .mockResolvedValueOnce({ id: 12, status: 'APPROVED' })
      .mockResolvedValueOnce({ id: 12, status: 'APPROVED' });

    await expect(service.approve(12, { id: 1, role: 'HR' })).resolves.toEqual(
      expect.objectContaining({ status: 'APPROVED' }),
    );
    await expect(service.approve(12, { id: 1, role: 'HR' })).rejects.toThrow(
      'Cannot approve ticket with status APPROVED',
    );
    expect(ticketUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid lifecycle transitions without mutation', async () => {
    authorizationService.canAccessOrganizationWide.mockReturnValue(true);
    ticketUpdateMany.mockResolvedValue({ count: 0 });

    ticketFindUnique.mockResolvedValueOnce({ id: 12, status: 'PENDING' });
    await expect(service.resolve(12, { id: 1, role: 'HR' })).rejects.toThrow(
      'Cannot resolve ticket with status PENDING',
    );

    ticketFindUnique.mockResolvedValueOnce({ id: 12, status: 'RESOLVED' });
    await expect(service.approve(12, { id: 1, role: 'HR' })).rejects.toThrow(
      'Cannot approve ticket with status RESOLVED',
    );

    ticketFindUnique.mockResolvedValueOnce({ id: 12, status: 'RESOLVED' });
    await expect(service.resolve(12, { id: 1, role: 'HR' })).rejects.toThrow(
      'Cannot resolve ticket with status RESOLVED',
    );
  });

  it('allows only one of two concurrent approvals to mutate the ticket', async () => {
    authorizationService.canAccessOrganizationWide.mockReturnValue(true);
    ticketUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    ticketFindUnique
      .mockResolvedValueOnce({ id: 12, status: 'APPROVED' })
      .mockResolvedValueOnce({ id: 12, status: 'APPROVED' });

    const results = await Promise.allSettled([
      service.approve(12, { id: 1, role: 'HR' }),
      service.approve(12, { id: 1, role: 'HR' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(ticketUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('allows only one concurrent resolve and sets resolvedAt once', async () => {
    authorizationService.canAccessOrganizationWide.mockReturnValue(true);
    ticketUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    ticketFindUnique
      .mockResolvedValueOnce({ id: 12, status: 'RESOLVED', resolvedAt: expect.any(Date) })
      .mockResolvedValueOnce({ id: 12, status: 'RESOLVED', resolvedAt: expect.any(Date) });

    const results = await Promise.allSettled([
      service.resolve(12, { id: 1, role: 'HR' }),
      service.resolve(12, { id: 1, role: 'HR' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(ticketUpdateMany).toHaveBeenCalledTimes(2);
    expect(ticketUpdateMany.mock.calls[0][0].data).toEqual({
      status: 'RESOLVED',
      resolvedAt: expect.any(Date),
    });
  });

  it('creates a ticket for valid issue and reason text', async () => {
    await expect(
      service.create(1, { issue: 'Laptop', reason: 'Screen is broken' }),
    ).resolves.toEqual({ id: 12, issue: 'Laptop', reason: 'Broken' });

    expect(ticketCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          issue: 'Laptop',
          reason: 'Screen is broken',
        }),
      }),
    );
  });

  it.each([
    ['issue', { issue: '', reason: 'Valid reason' }],
    ['issue', { issue: '   ', reason: 'Valid reason' }],
    ['reason', { issue: 'Valid issue', reason: '' }],
    ['reason', { issue: 'Valid issue', reason: '   ' }],
  ])('rejects invalid %s before employee lookup or persistence', async (_field, dto) => {
    await expect(service.create(1, dto as any)).rejects.toThrow(BadRequestException);
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(ticketCreate).not.toHaveBeenCalled();
  });

  it('preserves valid existing issue and reason text', async () => {
    await service.create(1, {
      issue: '  Laptop will not start  ',
      reason: '  The user cannot work  ',
    });

    expect(ticketCreate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        issue: '  Laptop will not start  ',
        reason: '  The user cannot work  ',
      }),
    );
  });
});