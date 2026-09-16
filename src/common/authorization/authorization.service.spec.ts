import { ForbiddenException } from '@nestjs/common';
import { EmployeeSelfOrAdminGuard } from '../guards/employee-self-or-admin.guard';
import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
  let prisma: {
    employee: {
      findUnique: jest.Mock;
    };
    team: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    user: {
      findUnique: jest.Mock;
    };
  };
  let service: AuthorizationService;

  beforeEach(() => {
    prisma = {
      employee: {
        findUnique: jest.fn(),
      },
      team: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          isActive: true,
          employee: { id: 10, status: 'ACTIVE' },
        }),
      },
    };
    service = new AuthorizationService(prisma as any);
  });

  it.each([
    ['SUPER_ADMIN', 'attendance', true],
    ['SUPER_ADMIN', 'leave', true],
    ['SUPER_ADMIN', 'documents', true],
    ['SUPER_ADMIN', 'salary', true],
    ['SUPER_ADMIN', 'assets', true],
    ['CEO', 'attendance', true],
    ['CEO', 'documents', true],
    ['HR', 'leave', true],
    ['HR', 'assets', true],
  ])('allows %s org-wide access for %s scope', (role, scope, expected) => {
    expect(
      service.canAccessOrganizationWide({ id: 1, role, employeeId: 10 }, scope as any),
    ).toBe(expected);
  });

  it.each(['employee', 'attendance', 'leave', 'documents', 'helpdesk', 'assets', 'dashboard', 'salary', 'team'])(
    'allows CEO organization-wide access for %s scope',
    (scope) => {
      expect(
        service.canAccessOrganizationWide({ id: 1, role: 'CEO', employeeId: 10 }, scope as any),
      ).toBe(true);
    },
  );

  it.each([
    ['FINANCE_MANAGER', 'attendance', false],
    ['FINANCE_MANAGER', 'leave', false],
    ['FINANCE_MANAGER', 'documents', false],
    ['FINANCE_MANAGER', 'assets', false],
    ['FINANCE_MANAGER', 'salary', true],
    ['FINANCE_MANAGER', 'employee', true],
    ['IT_MANAGER', 'employee', true],
    ['SALES_MANAGER', 'employee', true],
    ['IT_MANAGER', 'attendance', false],
    ['SALES_MANAGER', 'documents', false],
    ['EMPLOYEE', 'salary', false],
    ['UNKNOWN', 'attendance', false],
    [undefined, 'attendance', false],
  ])('checks org-wide policy for %s on %s scope', (role, scope, expected) => {
    expect(
      service.canAccessOrganizationWide(
        role ? { id: 1, role, employeeId: 10 } : undefined,
        scope as any,
      ),
    ).toBe(expected);
  });

  it('allows EMPLOYEE organization-wide safe directory reads', () => {
    expect(
      service.canAccessOrganizationWide({ id: 1, role: 'EMPLOYEE', employeeId: 10 }, 'employee'),
    ).toBe(true);
  });

  it('denies asset/org-wide access to FINANCE_MANAGER and unrelated roles', () => {
    expect(service.canAccessOrganizationWide({ id: 1, role: 'FINANCE_MANAGER', employeeId: 10 }, 'assets')).toBe(false);
    expect(service.canAccessOrganizationWide({ id: 1, role: 'IT_MANAGER', employeeId: 10 }, 'assets')).toBe(false);
    expect(service.canAccessOrganizationWide({ id: 1, role: 'EMPLOYEE', employeeId: 10 }, 'documents')).toBe(false);
  });

  it('denies client-supplied role and employeeId from bypassing ownership checks', async () => {
    await expect(
      service.canAccessEmployee({ id: 1, role: 'EMPLOYEE', employeeId: 55 }, 77),
    ).resolves.toBe(false);

    await expect(
      service.canAccessEmployee({ id: 1, role: 'UNKNOWN', employeeId: 7 }, 12),
    ).resolves.toBe(false);
  });

  it('denies access for an inactive user even with a valid token', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 1,
      isActive: false,
      employee: { id: 10, status: 'ACTIVE' },
    });

    await expect(
      service.canAccessEmployee({ id: 1, role: 'EMPLOYEE', employeeId: 10 }, 10),
    ).resolves.toBe(false);

    await expect(
      service.canAccessOrganizationWide({ id: 1, role: 'HR', employeeId: 10, isActive: false }, 'attendance'),
    ).toBe(false);
  });

  it('denies employee-scoped access when the linked employee is inactive', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 1,
      isActive: true,
      employee: { id: 10, status: 'INACTIVE' },
    });

    await expect(
      service.canAccessEmployee({ id: 1, role: 'EMPLOYEE', employeeId: 10 }, 10),
    ).resolves.toBe(false);
  });

  it('allows reactivated user and employee to access again', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 1,
      isActive: true,
      employee: { id: 10, status: 'ACTIVE' },
    });

    await expect(
      service.canAccessEmployee({ id: 1, role: 'EMPLOYEE', employeeId: 10 }, 10),
    ).resolves.toBe(true);
  });

  it('denies client-supplied employeeId/teamId from bypassing inactive status checks', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 1,
      isActive: true,
      employee: { id: 10, status: 'INACTIVE' },
    });

    await expect(
      service.canAccessEmployee({ id: 1, role: 'MANAGER', employeeId: 999 }, 77),
    ).resolves.toBe(false);

    await expect(
      service.canAccessTeam({ id: 1, role: 'IT_MANAGER', employeeId: 999 }, 1),
    ).resolves.toBe(false);
  });

  it('prevents IT_MANAGER from accessing Sales team scope and SALES_MANAGER from accessing IT team scope', async () => {
    prisma.team.findUnique
      .mockResolvedValueOnce({ id: 2, managerId: 20 })
      .mockResolvedValueOnce({ id: 1, managerId: 10 });

    await expect(
      service.canAccessTeam({ id: 1, role: 'IT_MANAGER', employeeId: 10 }, 2),
    ).resolves.toBe(false);

    await expect(
      service.canAccessTeam({ id: 1, role: 'SALES_MANAGER', employeeId: 11 }, 1),
    ).resolves.toBe(false);
  });

  it.each([
    ['SUPER_ADMIN', 101, true],
    ['SUPER_ADMIN', 202, true],
    ['CEO', 101, true],
    ['CEO', 202, true],
    ['HR', 303, true],
    ['FINANCE_MANAGER', 101, false],
    ['FINANCE_MANAGER', 202, false],
  ])('evaluates %s employee access for %d', async (role, targetId, expected) => {
    await expect(
      service.canAccessEmployee({ id: 1, role, employeeId: 10 }, targetId),
    ).resolves.toBe(expected);

    if (role === 'FINANCE_MANAGER') {
      expect(prisma.employee.findUnique).toHaveBeenCalled();
      return;
    }

    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('allows CEO organization-wide access', async () => {
    await expect(service.canAccessEmployee({ id: 1, role: 'CEO', employeeId: 5 }, 77)).resolves.toBe(true);
  });

  it('allows SUPER_ADMIN organization-wide access', async () => {
    await expect(service.canAccessEmployee({ id: 1, role: 'SUPER_ADMIN', employeeId: 5 }, 77)).resolves.toBe(true);
  });

  it('allows HR broad HR operational access', async () => {
    await expect(service.canAccessEmployee({ id: 1, role: 'HR', employeeId: 8 }, 77)).resolves.toBe(true);
  });

  it('allows IT_MANAGER to access their own IT team employee', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 20,
      teamId: 1,
      team: { id: 1, name: 'IT', managerId: 10 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 1, managerId: 10 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'IT_MANAGER', employeeId: 10 },
        20,
      ),
    ).resolves.toBe(true);
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'])(
    'allows %s to access their own employee record for self Leave',
    async (role) => {
      await expect(
        service.canAccessEmployee({ id: 1, role, employeeId: 10 }, 10),
      ).resolves.toBe(true);
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    },
  );

  it('denies IT_MANAGER access to another department', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 30,
      teamId: 2,
      team: { id: 2, name: 'SALES', managerId: 30 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 1, managerId: 10 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'IT_MANAGER', employeeId: 10 },
        30,
      ),
    ).resolves.toBe(false);
  });

  it('denies SALES_MANAGER access to another department', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 40,
      teamId: 6,
      team: { id: 6, name: 'FINANCE', managerId: 40 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 2, managerId: 11 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'SALES_MANAGER', employeeId: 11 },
        40,
      ),
    ).resolves.toBe(false);
  });

  it('denies FINANCE_MANAGER access to another department', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 50,
      teamId: 1,
      team: { id: 1, name: 'IT', managerId: 10 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 6, managerId: 12 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'FINANCE_MANAGER', employeeId: 12 },
        50,
      ),
    ).resolves.toBe(false);
  });

  it('denies IT_MANAGER access to a Finance employee', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 40,
      teamId: 6,
      team: { id: 6, name: 'FINANCE', managerId: 40 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 1, managerId: 10 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'IT_MANAGER', employeeId: 10 },
        40,
      ),
    ).resolves.toBe(false);
  });

  it('allows SALES_MANAGER to access their own Sales team employee', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 21,
      teamId: 2,
      team: { id: 2, name: 'SALES', managerId: 11 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 2, managerId: 11 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'SALES_MANAGER', employeeId: 11 },
        21,
      ),
    ).resolves.toBe(true);
  });

  it('denies client-supplied scope identifiers from bypassing authorization', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 21,
      teamId: 2,
      team: { id: 2, name: 'SALES', managerId: 11 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 1, managerId: 10 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'SALES_MANAGER', employeeId: 11 },
        21,
      ),
    ).resolves.toBe(false);

    prisma.team.findMany.mockResolvedValueOnce([{ id: 2, managerId: 11 }]);

    await expect(
      service.canAccessTeam({ id: 1, role: 'SALES_MANAGER', employeeId: 11 }, 999),
    ).resolves.toBe(false);
  });

  it.each([
    'Sales Operator',
    'Sales Intern',
    'Sales Customer Manager',
    'Sales Executive',
    'Future Sales Designation',
  ])('allows a Sales team employee regardless of designation: %s', async (designation) => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 21,
      teamId: 2,
      designation,
      team: { id: 2, name: 'Sales', managerId: 11 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 2, managerId: 11 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'SALES_MANAGER', employeeId: 11 },
        21,
      ),
    ).resolves.toBe(true);
  });

  it('denies a Sales-like designation when the employee belongs to IT', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 22,
      teamId: 1,
      designation: 'Sales Operator',
      team: { id: 1, name: 'IT', managerId: 10 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 2, managerId: 11 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'SALES_MANAGER', employeeId: 11 },
        22,
      ),
    ).resolves.toBe(false);
  });

  it.each(['Senior Developer', 'IT Intern', 'Any Future IT Designation']) (
    'allows an IT team employee regardless of designation: %s',
    async (designation) => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        id: 23,
        teamId: 1,
        designation,
        team: { id: 1, name: 'IT', managerId: 10 },
      });
      prisma.team.findMany.mockResolvedValueOnce([{ id: 1, managerId: 10 }]);

      await expect(
        service.canAccessEmployee(
          { id: 1, role: 'IT_MANAGER', employeeId: 10 },
          23,
        ),
      ).resolves.toBe(true);
    },
  );

  it('denies SALES_MANAGER access to an IT employee', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 22,
      teamId: 1,
      team: { id: 1, name: 'IT', managerId: 10 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 2, managerId: 11 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'SALES_MANAGER', employeeId: 11 },
        22,
      ),
    ).resolves.toBe(false);
  });

  it('denies SALES_MANAGER access to a Finance employee', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 40,
      teamId: 6,
      team: { id: 6, name: 'FINANCE', managerId: 40 },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 2, managerId: 11 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'SALES_MANAGER', employeeId: 11 },
        40,
      ),
    ).resolves.toBe(false);
  });

  it('allows EMPLOYEE to access their own employee record', async () => {
    await expect(
      service.canAccessEmployee({ id: 1, role: 'EMPLOYEE', employeeId: 55 }, 55),
    ).resolves.toBe(true);
  });

  it('keeps employee self-access valid while blocking others', async () => {
    await expect(service.canAccessEmployee({ id: 1, role: 'EMPLOYEE', employeeId: 55 }, 55)).resolves.toBe(true);
    await expect(service.canAccessEmployee({ id: 1, role: 'EMPLOYEE', employeeId: 55 }, 77)).resolves.toBe(false);
  });

  it('denies EMPLOYEE access to another employee record', async () => {
    await expect(
      service.canAccessEmployee({ id: 1, role: 'EMPLOYEE', employeeId: 55 }, 77),
    ).resolves.toBe(false);
  });

  it('returns false for missing authenticated user', async () => {
    await expect(service.canAccessEmployee(undefined, 55)).resolves.toBe(false);
  });

  it('returns false when manager employee id is missing', async () => {
    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'IT_MANAGER', employeeId: null },
        20,
      ),
    ).resolves.toBe(false);
  });

  it('returns false when the manager has no valid team', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 10,
      teamId: null,
      team: null,
    });

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'IT_MANAGER', employeeId: 10 },
        20,
      ),
    ).resolves.toBe(false);
  });

  it('returns false when the target employee has no team', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 20,
      teamId: null,
      team: null,
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 1, managerId: 10 }]);

    await expect(
      service.canAccessEmployee(
        { id: 1, role: 'IT_MANAGER', employeeId: 10 },
        20,
      ),
    ).resolves.toBe(false);
  });

  it('allows CEO to approve a manager request when the target is not the CEO', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 9,
      teamId: 2,
      team: { id: 2, name: 'SALES', managerId: 11 },
      user: { role: 'SALES_MANAGER' },
    });

    await expect(
      service.canApproveOrRejectRequest({ id: 1, role: 'CEO', employeeId: 5 }, 9),
    ).resolves.toBe(true);
  });

  it.each([
    ['IT_MANAGER', 'IT', 12, true],
    ['HR', 'IT', 12, true],
    ['SUPER_ADMIN', 'IT', 12, true],
    ['IT_MANAGER', 'SALES', 12, false],
    ['SALES_MANAGER', 'IT', 12, false],
    ['FINANCE_MANAGER', 'IT', 12, false],
    ['EMPLOYEE', 'IT', 12, false],
  ])('approves the locked employee-team pool for %s on %s requests', async (actorRole, teamName, targetId, expected) => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: targetId,
      teamId: teamName === 'IT' ? 1 : 2,
      team: { id: teamName === 'IT' ? 1 : 2, name: teamName, managerId: teamName === 'IT' ? 10 : 11 },
      user: { role: 'EMPLOYEE' },
    });

    if (actorRole === 'IT_MANAGER') {
      prisma.team.findMany.mockResolvedValueOnce([{ id: 1, managerId: 10 }]);
    }

    await expect(
      service.canApproveOrRejectRequest({ id: 1, role: actorRole, employeeId: actorRole === 'IT_MANAGER' ? 10 : actorRole === 'SALES_MANAGER' ? 11 : actorRole === 'FINANCE_MANAGER' ? 12 : 99 }, targetId),
    ).resolves.toBe(expected);
  });

  it.each([
    ['IT_MANAGER', 'IT', 10, true],
    ['SALES_MANAGER', 'SALES', 11, true],
    ['FINANCE_MANAGER', 'FINANCE', 13, true],
  ])('allows a department manager to approve only within their managed team: %s on %s', async (actorRole, teamName, actorEmployeeId, expected) => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 20,
      teamId: teamName === 'IT' ? 1 : teamName === 'SALES' ? 2 : 3,
      team: { id: teamName === 'IT' ? 1 : teamName === 'SALES' ? 2 : 3, name: teamName, managerId: actorEmployeeId },
      user: { role: 'EMPLOYEE' },
    });
    prisma.team.findMany.mockResolvedValueOnce([
      { id: teamName === 'IT' ? 1 : teamName === 'SALES' ? 2 : 3, managerId: actorEmployeeId },
    ]);

    await expect(
      service.canApproveOrRejectRequest({ id: 1, role: actorRole, employeeId: actorEmployeeId }, 20),
    ).resolves.toBe(expected);
  });

  it('rejects self-approval for an employee request', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 20,
      teamId: 1,
      team: { id: 1, name: 'IT', managerId: 10 },
      user: { role: 'EMPLOYEE' },
    });

    await expect(
      service.canApproveOrRejectRequest({ id: 1, role: 'IT_MANAGER', employeeId: 20 }, 20),
    ).resolves.toBe(false);
  });

  it('rejects a wrong-department manager approval', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 30,
      teamId: 2,
      team: { id: 2, name: 'SALES', managerId: 11 },
      user: { role: 'EMPLOYEE' },
    });
    prisma.team.findMany.mockResolvedValueOnce([{ id: 1, managerId: 10 }]);

    await expect(
      service.canApproveOrRejectRequest({ id: 1, role: 'IT_MANAGER', employeeId: 10 }, 30),
    ).resolves.toBe(false);
  });

  it.each([
    ['HR', 'IT_MANAGER', true],
    ['SUPER_ADMIN', 'IT_MANAGER', true],
    ['CEO', 'IT_MANAGER', true],
    ['HR', 'HR', false],
    ['SUPER_ADMIN', 'HR', true],
    ['CEO', 'HR', true],
  ])('handles the locked higher-level approval chain for %s approving %s', async (actorRole, targetRole, expected) => {
    const targetEmployeeId = targetRole === 'IT_MANAGER' ? 7 : targetRole === 'HR' ? 8 : 9;
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: targetEmployeeId,
      teamId: 1,
      team: { id: 1, name: 'IT', managerId: 10 },
      user: { role: targetRole },
    });

    await expect(
      service.canApproveOrRejectRequest({ id: 1, role: actorRole, employeeId: actorRole === 'CEO' ? 5 : 20 }, targetEmployeeId),
    ).resolves.toBe(expected);
  });

  it('treats CEO-owned requests as not requiring approval', async () => {
    await expect(
      service.canApproveOrRejectRequest({ id: 1, role: 'CEO', employeeId: 50 }, 50),
    ).resolves.toBe(false);
  });

  it('allows org-wide roles to access a team', async () => {
    await expect(
      service.canAccessTeam({ id: 1, role: 'CEO', employeeId: 5 }, 42),
    ).resolves.toBe(true);
  });

  it('allows IT_MANAGER to access their own assigned team even when the team name is not IT', async () => {
    prisma.team.findMany.mockResolvedValueOnce([{ id: 1, managerId: 10 }]);

    await expect(
      service.canAccessTeam({ id: 1, role: 'IT_MANAGER', employeeId: 10 }, 1),
    ).resolves.toBe(true);
  });

  it('denies EMPLOYEE team access', async () => {
    await expect(
      service.canAccessTeam({ id: 1, role: 'EMPLOYEE', employeeId: 10 }, 1),
    ).resolves.toBe(false);
  });

  it('allows resource access by employee id for self-only employees', async () => {
    await expect(
      service.canAccessResource(
        { id: 1, role: 'EMPLOYEE', employeeId: 55 },
        { employeeId: 55 },
      ),
    ).resolves.toBe(true);
  });

  it('allows org-wide roles to access any resource without a specific employee/team id', async () => {
    await expect(
      service.canAccessResource({ id: 1, role: 'HR', employeeId: 2 }, {}),
    ).resolves.toBe(true);
  });

  it('denies unknown roles generic resource access', async () => {
    await expect(
      service.canAccessResource({ id: 1, role: 'UNKNOWN', employeeId: 2 }, {}),
    ).resolves.toBe(false);
  });
});

describe('EmployeeSelfOrAdminGuard', () => {
  let authService: { canAccessEmployee: jest.Mock };
  let guard: EmployeeSelfOrAdminGuard;

  beforeEach(() => {
    authService = {
      canAccessEmployee: jest.fn(),
    };
    guard = new EmployeeSelfOrAdminGuard(authService as any);
  });

  it('allows access when the centralized authorization service permits it', async () => {
    authService.canAccessEmployee.mockResolvedValue(true);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 1, role: 'EMPLOYEE', employeeId: 7 },
          params: { id: '7' },
        }),
      }),
    };

    await expect(guard.canActivate(context as any)).resolves.toBe(true);
  });

  it('throws when the centralized authorization service denies access', async () => {
    authService.canAccessEmployee.mockResolvedValue(false);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 1, role: 'EMPLOYEE', employeeId: 7 },
          params: { id: '8' },
        }),
      }),
    };

    await expect(guard.canActivate(context as any)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('requires an employee id in the request params', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 1, role: 'EMPLOYEE', employeeId: 7 },
          params: {},
        }),
      }),
    };

    await expect(guard.canActivate(context as any)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
