import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PositiveIntPipe, WfhController } from './wfh.controller';
import { WfhService } from './wfh.service';

describe('WFH authorization', () => {
  const user = (role: string, employeeId?: number | null) => ({
    id: 1,
    role,
    employeeId,
  });

  const createPrisma = () => ({
    employee: { findUnique: jest.fn() },
    team: { findMany: jest.fn(), findUnique: jest.fn() },
    wFHRequest: { findUnique: jest.fn(), findMany: jest.fn() },
  });

  describe('AuthorizationService management policy', () => {
    it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s organization-wide management', (role) => {
      const service = new AuthorizationService(createPrisma() as any);

      expect(service.canManageWfh(user(role, 10))).toBe(true);
      expect(service.canManageWfhOrganizationWide(user(role, 10))).toBe(true);
    });

    it.each(['FINANCE_MANAGER', 'EMPLOYEE', 'UNKNOWN'])('denies %s management access', (role) => {
      const service = new AuthorizationService(createPrisma() as any);

      expect(service.canManageWfh(user(role, 10))).toBe(false);
      expect(service.canManageWfhOrganizationWide(user(role, 10))).toBe(false);
    });

    it('denies missing identity', () => {
      const service = new AuthorizationService(createPrisma() as any);

      expect(service.canManageWfh(undefined)).toBe(false);
      expect(service.canManageWfhOrganizationWide(undefined)).toBe(false);
    });

    it('allows IT_MANAGER access to an employee in the manager assigned team', async () => {
      const prisma = createPrisma();
      prisma.wFHRequest.findUnique.mockResolvedValue({ employeeId: 20 });
      prisma.employee.findUnique.mockResolvedValue({ id: 20, teamId: 1 });
      prisma.team.findMany.mockResolvedValue([{ id: 1, managerId: 10 }]);
      const service = new AuthorizationService(prisma as any);

      await expect(
        service.canManageWfhRequest(user('IT_MANAGER', 10), 100),
      ).resolves.toBe(true);
    });

    it('denies IT_MANAGER access to an employee outside the assigned team', async () => {
      const prisma = createPrisma();
      prisma.wFHRequest.findUnique.mockResolvedValue({ employeeId: 30 });
      prisma.employee.findUnique.mockResolvedValue({ id: 30, teamId: 2 });
      prisma.team.findMany.mockResolvedValue([{ id: 1, managerId: 10 }]);
      const service = new AuthorizationService(prisma as any);

      await expect(
        service.canManageWfhRequest(user('IT_MANAGER', 10), 100),
      ).resolves.toBe(false);
    });

    it('allows SALES_MANAGER access to an employee in the manager assigned team', async () => {
      const prisma = createPrisma();
      prisma.wFHRequest.findUnique.mockResolvedValue({ employeeId: 21 });
      prisma.employee.findUnique.mockResolvedValue({ id: 21, teamId: 2 });
      prisma.team.findMany.mockResolvedValue([{ id: 2, managerId: 11 }]);
      const service = new AuthorizationService(prisma as any);

      await expect(
        service.canManageWfhRequest(user('SALES_MANAGER', 11), 101),
      ).resolves.toBe(true);
    });

    it('denies SALES_MANAGER access to an employee outside the assigned team', async () => {
      const prisma = createPrisma();
      prisma.wFHRequest.findUnique.mockResolvedValue({ employeeId: 22 });
      prisma.employee.findUnique.mockResolvedValue({ id: 22, teamId: 1 });
      prisma.team.findMany.mockResolvedValue([{ id: 2, managerId: 11 }]);
      const service = new AuthorizationService(prisma as any);

      await expect(
        service.canManageWfhRequest(user('SALES_MANAGER', 11), 101),
      ).resolves.toBe(false);
    });

    it('uses the persisted WFH owner and ignores client-supplied identity fields', async () => {
      const prisma = createPrisma();
      prisma.wFHRequest.findUnique.mockResolvedValue({ employeeId: 30 });
      prisma.employee.findUnique.mockResolvedValue({ id: 30, teamId: 2 });
      prisma.team.findMany.mockResolvedValue([{ id: 1, managerId: 10 }]);
      const service = new AuthorizationService(prisma as any);
      const managerWithSpoofedFields = {
        ...user('IT_MANAGER', 10),
        employeeId: 20,
        teamId: 2,
        managerId: 30,
      };

      await expect(
        service.canManageWfhRequest(managerWithSpoofedFields, 100),
      ).resolves.toBe(false);
      expect(prisma.wFHRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 100 },
        select: { employeeId: true },
      });
    });
  });

  describe('WfhController management routes', () => {
    const createController = () => {
      const service = {
        request: jest.fn().mockResolvedValue({ id: 1 }),
        approve: jest.fn().mockResolvedValue({ id: 1, status: 'APPROVED' }),
        reject: jest.fn().mockResolvedValue({ id: 1, status: 'REJECTED' }),
        getAll: jest.fn().mockResolvedValue([]),
        getMyRequests: jest.fn().mockResolvedValue([]),
      } as any;
      const authorizationService = {
        canAccessEmployee: jest.fn().mockResolvedValue(true),
        canManageWfh: jest.fn(),
        canManageWfhOrganizationWide: jest.fn(),
        getWfhManagedTeamIds: jest.fn(),
        canManageWfhRequest: jest.fn(),
      } as any;
      const controller = new WfhController(service, {} as any, authorizationService);
      return { controller, service, authorizationService };
    };

    it('keeps employee request creation based on authenticated employee identity', async () => {
      const { controller, service, authorizationService } = createController();
      const dto = { startDate: '2026-09-10', endDate: '2026-09-10', employeeId: 999 } as any;
      const requestUser = user('EMPLOYEE', 55);

      await expect(controller.request({ user: requestUser }, dto)).resolves.toEqual({
        success: true,
        request: { id: 1 },
      });

      expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(requestUser, 55);
      expect(service.request).toHaveBeenCalledWith(55, dto);
    });

    it.each(['SUPER_ADMIN', 'CEO', 'HR'])('keeps %s organization-wide /all access', async (role) => {
      const { controller, service, authorizationService } = createController();
      const requestUser = user(role, 10);
      authorizationService.canManageWfh.mockReturnValue(true);
      authorizationService.canManageWfhOrganizationWide.mockReturnValue(true);

      await controller.getAll({ user: requestUser });

      expect(service.getAll).toHaveBeenCalledWith();
      expect(authorizationService.getWfhManagedTeamIds).not.toHaveBeenCalled();
    });

    it('allows ADMIN to fetch organization-wide WFH requests', async () => {
      const { controller, service, authorizationService } = createController();
      const requestUser = user('ADMIN', 10);
      authorizationService.canManageWfh.mockReturnValue(true);
      authorizationService.canManageWfhOrganizationWide.mockReturnValue(true);

      await controller.getAll({ user: requestUser });

      expect(service.getAll).toHaveBeenCalledWith();
    });

    it.each(['IT_MANAGER', 'SALES_MANAGER'])('scopes %s /all access to persisted assigned teams', async (role) => {
      const { controller, service, authorizationService } = createController();
      const requestUser = user(role, 10);
      authorizationService.canManageWfh.mockReturnValue(true);
      authorizationService.canManageWfhOrganizationWide.mockReturnValue(false);
      authorizationService.getWfhManagedTeamIds.mockResolvedValue([7]);

      await controller.getAll({ user: requestUser });

      expect(authorizationService.getWfhManagedTeamIds).toHaveBeenCalledWith(requestUser);
      expect(service.getAll).toHaveBeenCalledWith([7]);
    });

    it.each(['FINANCE_MANAGER', 'EMPLOYEE'])('denies %s /all access', async (role) => {
      const { controller, service, authorizationService } = createController();
      authorizationService.canManageWfh.mockReturnValue(false);

      await expect(controller.getAll({ user: user(role, 10) })).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.getAll).not.toHaveBeenCalled();
    });

    it('denies /all access for missing identity', async () => {
      const { controller, service, authorizationService } = createController();
      authorizationService.canManageWfh.mockReturnValue(false);

      await expect(controller.getAll({ user: undefined })).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.getAll).not.toHaveBeenCalled();
    });

    it('authorizes approve against the actual WFH request owner', async () => {
      const { controller, service, authorizationService } = createController();
      authorizationService.canManageWfhRequest.mockResolvedValue(true);

      await controller.approve({ user: user('IT_MANAGER', 10) }, 100);

      expect(authorizationService.canManageWfhRequest).toHaveBeenCalledWith(user('IT_MANAGER', 10), 100);
      expect(service.approve).toHaveBeenCalledWith(100);
    });

    it('denies approve when the actual WFH request owner is outside the manager team', async () => {
      const { controller, service, authorizationService } = createController();
      authorizationService.canManageWfhRequest.mockResolvedValue(false);

      await expect(
        controller.approve({ user: user('IT_MANAGER', 10) }, 100),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.approve).not.toHaveBeenCalled();
    });

    it('authorizes reject against the actual WFH request owner', async () => {
      const { controller, service, authorizationService } = createController();
      authorizationService.canManageWfhRequest.mockResolvedValue(true);

      await controller.reject({ user: user('SALES_MANAGER', 11) }, 101);

      expect(authorizationService.canManageWfhRequest).toHaveBeenCalledWith(user('SALES_MANAGER', 11), 101);
      expect(service.reject).toHaveBeenCalledWith(101);
    });

    it('denies reject when the actual WFH request owner is outside the manager team', async () => {
      const { controller, service, authorizationService } = createController();
      authorizationService.canManageWfhRequest.mockResolvedValue(false);

      await expect(
        controller.reject({ user: user('SALES_MANAGER', 11) }, 101),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.reject).not.toHaveBeenCalled();
    });

    it.each(['APPROVED', 'REJECTED'])('updates request status to %s', async (status) => {
      const { controller, service, authorizationService } = createController();
      authorizationService.canManageWfhRequest.mockResolvedValue(true);

      await controller.updateStatus(
        { user: user('SUPER_ADMIN', 10) },
        100,
        status,
      );

      expect(status === 'APPROVED' ? service.approve : service.reject)
        .toHaveBeenCalledWith(100);
    });

    it('rejects unsupported status values', async () => {
      const { controller, service, authorizationService } = createController();
      authorizationService.canManageWfhRequest.mockResolvedValue(true);

      await expect(controller.updateStatus(
        { user: user('SUPER_ADMIN', 10) },
        100,
        'PENDING',
      )).rejects.toBeInstanceOf(BadRequestException);
      expect(service.approve).not.toHaveBeenCalled();
      expect(service.reject).not.toHaveBeenCalled();
    });
  });

  it('filters WFH /all queries by persisted employee team IDs', async () => {
    const prisma = createPrisma();
    prisma.wFHRequest.findMany.mockResolvedValue([]);
    const service = new WfhService(prisma as any, {} as any);

    await service.getAll([7]);

    expect(prisma.wFHRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { employee: { teamId: { in: [7] } } },
    }));
  });

  describe('positive integer route IDs', () => {
    const pipe = new PositiveIntPipe();

    it.each(['1', '42'])('accepts valid approve/reject route IDs: %s', (value) => {
      expect(pipe.transform(value, {} as any)).toBe(Number(value));
    });

    it.each(['abc', '', '0', '-1', '1.5', 'NaN', '1abc'])(
      'rejects invalid approve/reject route ID: %s',
      (value) => {
        expect(() => pipe.transform(value, {} as any)).toThrow(
          'Validation failed (positive integer is expected)',
        );
      },
    );
  });
});
