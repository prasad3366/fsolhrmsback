import { AuthorizationService } from '../common/authorization/authorization.service';

describe('Leave workflow authorization hierarchy', () => {
  const createAuthorization = (target: any, managedTeamIds: number[] = []) => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          isActive: true,
          employee: { id: 10, status: 'ACTIVE' },
        }),
      },
      employee: { findUnique: jest.fn().mockResolvedValue(target) },
      team: { findMany: jest.fn().mockResolvedValue(managedTeamIds.map((id) => ({ id })) ) },
    } as any;

    return {
      service: new AuthorizationService(prisma),
      prisma,
    };
  };

  it.each(['CEO', 'SUPER_ADMIN'])('allows %s organization-wide employee approval', async (role) => {
    const { service } = createAuthorization({
      id: 77,
      teamId: 1,
      team: { id: 1, name: 'IT', managerId: 20 },
      user: { role: 'EMPLOYEE' },
    });

    await expect(service.canApproveOrRejectRequest({ id: 1, role, employeeId: 10 }, 77))
      .resolves.toBe(true);
  });

  it('allows a manager only inside the authenticated managed team and never for self', async () => {
    const { service } = createAuthorization({
      id: 77,
      teamId: 1,
      team: { id: 1, name: 'IT', managerId: 10 },
      user: { role: 'EMPLOYEE' },
    }, [1]);

    await expect(service.canApproveOrRejectRequest(
      { id: 1, role: 'IT_MANAGER', employeeId: 10, teamId: 999, managerId: 999 } as any,
      77,
    )).resolves.toBe(true);

    await expect(service.canApproveOrRejectRequest(
      { id: 1, role: 'IT_MANAGER', employeeId: 10 },
      10,
    )).resolves.toBe(false);
  });

  it('denies a manager access to another department team', async () => {
    const { service } = createAuthorization({
      id: 77,
      teamId: 2,
      team: { id: 2, name: 'SALES', managerId: 11 },
      user: { role: 'EMPLOYEE' },
    }, [1]);

    await expect(service.canApproveOrRejectRequest(
      { id: 1, role: 'IT_MANAGER', employeeId: 10 },
      77,
    )).resolves.toBe(false);
  });

  it('routes manager leave upward to HR and HR leave upward to CEO or SUPER_ADMIN', async () => {
    const managerTarget = {
      id: 77,
      teamId: 1,
      team: { id: 1, name: 'IT', managerId: 10 },
      user: { role: 'IT_MANAGER' },
    };
    const { service: managerService } = createAuthorization(managerTarget);

    await expect(managerService.canApproveOrRejectRequest(
      { id: 1, role: 'HR', employeeId: 20 },
      77,
    )).resolves.toBe(true);

    const hrTarget = {
      id: 77,
      teamId: null,
      team: null,
      user: { role: 'HR' },
    };
    const { service: hrService } = createAuthorization(hrTarget);

    await expect(hrService.canApproveOrRejectRequest(
      { id: 1, role: 'CEO', employeeId: 20 },
      77,
    )).resolves.toBe(true);
    await expect(hrService.canApproveOrRejectRequest(
      { id: 1, role: 'SUPER_ADMIN', employeeId: 20 },
      77,
    )).resolves.toBe(true);
    await expect(hrService.canApproveOrRejectRequest(
      { id: 1, role: 'HR', employeeId: 20 },
      77,
    )).resolves.toBe(false);
  });
});