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

  it.each([
    ['FINANCE_MANAGER', 'attendance', false],
    ['FINANCE_MANAGER', 'leave', false],
    ['FINANCE_MANAGER', 'documents', false],
    ['FINANCE_MANAGER', 'assets', false],
    ['FINANCE_MANAGER', 'salary', true],
    ['FINANCE_MANAGER', 'employee', true],
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
    ['FINANCE_MANAGER', 101, true],
    ['FINANCE_MANAGER', 202, true],
  ])('allows %s to access employee %d', async (role, targetId, expected) => {
    await expect(
      service.canAccessEmployee({ id: 1, role, employeeId: 10 }, targetId),
    ).resolves.toBe(expected);

    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
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

  it('denies IT_MANAGER access to a Sales employee', async () => {
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

  it('allows org-wide roles to access a team', async () => {
    await expect(
      service.canAccessTeam({ id: 1, role: 'CEO', employeeId: 5 }, 42),
    ).resolves.toBe(true);
  });

  it('allows IT_MANAGER to access their own assigned team even when the team name is not IT', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 10,
      teamId: 1,
      team: { id: 1, name: 'INFRA', managerId: 10 },
    });

    prisma.team = {
      findUnique: jest.fn().mockResolvedValue({ id: 1, managerId: 10 }),
    } as any;

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
