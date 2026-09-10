import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

describe('EmployeesService employee collection authorization', () => {
  const employeeFindMany = jest.fn();
  const employeeCount = jest.fn();
  const teamFindMany = jest.fn();
  const prisma = {
    employee: { findMany: employeeFindMany, count: employeeCount },
    team: { findMany: teamFindMany },
  } as any;
  const mailService = {} as any;
  const authorizationService = {
    canAccessOrganizationWide: jest.fn((user: { role: string }) =>
      ['SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER'].includes(user.role),
    ),
  } as any;
  let service: EmployeesService;

  beforeEach(() => {
    jest.clearAllMocks();
    employeeFindMany.mockResolvedValue([]);
    employeeCount.mockResolvedValue(0);
    teamFindMany.mockResolvedValue([]);
    service = new EmployeesService(prisma, mailService, authorizationService);
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER'])(
    '%s retains the unfiltered employee collection',
    async (role) => {
      await service.getAllEmployees({ id: 1, role, employeeId: 10 });

      expect(teamFindMany).not.toHaveBeenCalled();
      expect(employeeFindMany.mock.calls[0][0].where).toBeUndefined();
    },
  );

  it.each(['IT_MANAGER', 'SALES_MANAGER'])(
    '%s receives only employees from teams managed by the authenticated employee',
    async (role) => {
      teamFindMany.mockResolvedValue([{ id: 3 }, { id: 7 }]);

      await service.getAllEmployees({
        id: 1,
        role,
        employeeId: 10,
        teamId: 999,
        managerId: 999,
      } as any);

      expect(teamFindMany).toHaveBeenCalledWith({
        where: { managerId: 10 },
        select: { id: true },
      });
      expect(employeeFindMany.mock.calls[0][0].where).toEqual({
        teamId: { in: [3, 7] },
      });
    },
  );

  it('searches numeric employee IDs within the existing authorization scope', async () => {
    await service.getAllEmployees(
      { id: 1, role: 'SALES_MANAGER', employeeId: 10 },
      { search: '7', page: 1, pageSize: 25 },
    );

    const searchWhere = employeeFindMany.mock.calls[0][0].where;
    expect(searchWhere.AND[1].OR).toContainEqual({ id: 7 });
    expect(searchWhere.AND[0]).toEqual({ teamId: { in: [] } });
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER'])(
    '%s receives no employees when the authenticated employee manages no teams',
    async (role) => {
      await service.getAllEmployees({ id: 1, role, employeeId: 10 });

      expect(employeeFindMany.mock.calls[0][0].where).toEqual({
        teamId: { in: [] },
      });
    },
  );

  it('does not admit EMPLOYEE to the collection endpoint', () => {
    const roles = Reflect.getMetadata('roles', EmployeesController.prototype.getAllEmployees);

    expect(roles).not.toContain('EMPLOYEE');
  });

  it('fails closed for EMPLOYEE even when the service is called directly', async () => {
    await service.getAllEmployees({ id: 1, role: 'EMPLOYEE', employeeId: 10 });

    expect(teamFindMany).not.toHaveBeenCalled();
    expect(employeeFindMany.mock.calls[0][0].where).toEqual({
      id: { in: [] },
    });
  });
});

describe('EmployeesService employee 360 profile', () => {
  const employeeFindUnique = jest.fn();
  const prisma = { employee: { findUnique: employeeFindUnique } } as any;
  const service = new EmployeesService(prisma, {} as any, {} as any);

  beforeEach(() => {
    jest.clearAllMocks();
    employeeFindUnique.mockResolvedValue({
      id: 7,
      empCode: 'E007',
      firstName: 'Ada',
      lastName: 'Lovelace',
      user: { id: 9, email: 'ada@example.com', role: 'EMPLOYEE', isActive: true },
      team: { id: 3, name: 'Engineering', manager: { id: 4, firstName: 'Grace', lastName: 'Hopper' } },
    });
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR', 'FINANCE_MANAGER', 'IT_MANAGER', 'SALES_MANAGER', 'EMPLOYEE'])(
    'returns a minimal safe projection for %s',
    async (role) => {
      const result = await service.getEmployee360Profile(7, role);
      const select = employeeFindUnique.mock.calls[0][0].select;

      expect(result).toEqual(expect.objectContaining({ id: 7, team: expect.any(Object) }));
      expect(select).not.toHaveProperty('bankAccountNumber');
      expect(select).not.toHaveProperty('ifscCode');
      expect(select).not.toHaveProperty('panNumber');
      expect(select).not.toHaveProperty('aadharNumber');
      expect(select).not.toHaveProperty('attendances');
      expect(select).not.toHaveProperty('leaves');
      expect(select).not.toHaveProperty('wfhRequests');
      expect(select).not.toHaveProperty('documents');
      expect(select).not.toHaveProperty('salaries');
      expect(select).not.toHaveProperty('payrolls');
    },
  );

  it('does not include detailed contact fields for team managers or finance', async () => {
    await service.getEmployee360Profile(7, 'IT_MANAGER');
    expect(employeeFindUnique.mock.calls[0][0].select).not.toHaveProperty('currentAddress');

    await service.getEmployee360Profile(7, 'FINANCE_MANAGER');
    expect(employeeFindUnique.mock.calls[1][0].select).not.toHaveProperty('currentAddress');
  });
});

describe('EmployeesService employee 360 hierarchy', () => {
  const employeeFindUnique = jest.fn();
  const prisma = { employee: { findUnique: employeeFindUnique } } as any;
  const authorizationService = { canAccessEmployee: jest.fn() } as any;
  const service = new EmployeesService(prisma, {} as any, authorizationService);

  beforeEach(() => {
    jest.clearAllMocks();
    authorizationService.canAccessEmployee.mockResolvedValue(true);
    employeeFindUnique.mockResolvedValue({
      id: 7,
      team: {
        id: 3,
        name: 'Engineering',
        manager: {
          id: 4,
          firstName: 'Grace',
          lastName: 'Hopper',
          designation: 'Engineering Manager',
        },
      },
    });
  });

  it('returns only the target hierarchy projection for an EMPLOYEE', async () => {
    const user = { id: 9, role: 'EMPLOYEE', employeeId: 7 };

    await expect(service.getEmployee360Hierarchy(user, 7)).resolves.toEqual({
      employeeId: 7,
      team: { id: 3, name: 'Engineering' },
      manager: {
        employeeId: 4,
        name: 'Grace Hopper',
        designation: 'Engineering Manager',
      },
      reportingRelationship: { type: 'TEAM_MANAGER', managerEmployeeId: 4 },
    });

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(user, 7);
    const select = employeeFindUnique.mock.calls[0][0].select;
    expect(select).toEqual({
      id: true,
      team: {
        select: {
          id: true,
          name: true,
          manager: {
            select: { id: true, firstName: true, lastName: true, designation: true },
          },
        },
      },
    });
    expect(select).not.toHaveProperty('team.members');
    expect(select).not.toHaveProperty('user');
  });

  it('denies an EMPLOYEE another employee hierarchy', async () => {
    authorizationService.canAccessEmployee.mockResolvedValue(false);

    await expect(
      service.getEmployee360Hierarchy({ id: 9, role: 'EMPLOYEE', employeeId: 7 }, 8),
    ).rejects.toThrow('Access denied for employee hierarchy');
    expect(employeeFindUnique).not.toHaveBeenCalled();
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER'])('allows %s for managed-team employees', async (role) => {
    await expect(
      service.getEmployee360Hierarchy({ id: 9, role, employeeId: 4 }, 7),
    ).resolves.toEqual(expect.objectContaining({ employeeId: 7 }));
  });

  it.each(['IT_MANAGER', 'SALES_MANAGER'])('denies %s outside-team employees', async (role) => {
    authorizationService.canAccessEmployee.mockResolvedValue(false);

    await expect(
      service.getEmployee360Hierarchy({ id: 9, role, employeeId: 4 }, 8),
    ).rejects.toThrow('Access denied for employee hierarchy');
  });

  it.each(['SUPER_ADMIN', 'CEO', 'HR'])('allows %s organization-wide hierarchy access', async (role) => {
    await expect(
      service.getEmployee360Hierarchy({ id: 9, role }, 7),
    ).resolves.toEqual(expect.objectContaining({ employeeId: 7 }));
  });

  it('denies FINANCE_MANAGER hierarchy access without consulting broader employee policy', async () => {
    await expect(
      service.getEmployee360Hierarchy({ id: 9, role: 'FINANCE_MANAGER', employeeId: 10 }, 7),
    ).rejects.toThrow('Access denied for employee hierarchy');
    expect(authorizationService.canAccessEmployee).not.toHaveBeenCalled();
    expect(employeeFindUnique).not.toHaveBeenCalled();
  });

  it('does not trust client-supplied team or manager identifiers', async () => {
    const user = { id: 9, role: 'IT_MANAGER', employeeId: 4, teamId: 999, managerId: 999 } as any;

    await service.getEmployee360Hierarchy(user, 7);

    expect(authorizationService.canAccessEmployee).toHaveBeenCalledWith(user, 7);
    expect(employeeFindUnique.mock.calls[0][0].where).toEqual({ id: 7 });
  });
});

describe('EmployeesService employee creation transaction', () => {
  it.each(['INACTIVE', 'ACTIVE'])(
    'creates a %s employee with matching User.isActive and emails credentials',
    async (status) => {
    const employeeCreate = jest.fn().mockResolvedValue({ id: 7 });
    const userCreate = jest.fn().mockResolvedValue({ id: 42 });
    const transaction = jest.fn(async (callback) =>
      callback({
        user: { create: userCreate },
        employee: { create: employeeCreate },
      }),
    );
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      employee: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: transaction,
    } as any;
    const mailService = { sendEmployeeCredentials: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new EmployeesService(prisma, mailService, {} as any);
    const dto = {
      email: 'new@example.com',
      empCode: 'EMP-42',
      role: 'EMPLOYEE',
      firstName: 'New',
      status,
    } as any;

    const response = await service.createEmployee(dto, 'HR');

    expect(response).toEqual({
      message: 'Employee created successfully',
      username: dto.email,
      role: dto.role,
    });
    expect(response).not.toHaveProperty('password');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isActive: status === 'ACTIVE',
      }),
    });
    expect(employeeCreate).toHaveBeenCalledTimes(1);
    expect(mailService.sendEmployeeCredentials).toHaveBeenCalledWith(
      dto.email,
      expect.any(String),
      dto.firstName,
    );
    },
  );

  it('rolls back the created user when employee creation fails', async () => {
    const committedUsers: unknown[] = [];
    const userCreate = jest.fn(async () => ({ id: 42 }));
    const employeeCreate = jest.fn().mockRejectedValue(new Error('employee creation failed'));
    const transaction = jest.fn(async (callback) => {
      const stagedUsers: unknown[] = [];
      const tx = {
        user: {
          create: jest.fn(async (...args: Parameters<typeof userCreate>) => {
            const user = await userCreate(...args);
            stagedUsers.push(user);
            return user;
          }),
        },
        employee: { create: employeeCreate },
      };

      try {
        const result = await callback(tx);
        committedUsers.push(...stagedUsers);
        return result;
      } catch (error) {
        stagedUsers.length = 0;
        throw error;
      }
    });
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      employee: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: transaction,
    } as any;
    const mailService = { sendEmployeeCredentials: jest.fn() } as any;
    const authorizationService = {} as any;
    const service = new EmployeesService(prisma, mailService, authorizationService);

    await expect(
      service.createEmployee(
        { email: 'new@example.com', empCode: 'EMP-42', role: 'EMPLOYEE', firstName: 'New' } as any,
        'HR',
      ),
    ).rejects.toThrow('employee creation failed');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(userCreate).toHaveBeenCalledTimes(1);
    expect(employeeCreate).toHaveBeenCalledTimes(1);
    expect(committedUsers).toEqual([]);
    expect(mailService.sendEmployeeCredentials).not.toHaveBeenCalled();
  });
});

describe('EmployeesService employee status synchronization', () => {
  it.each([
    ['INACTIVE', false],
    ['ACTIVE', true],
  ])(
    'updates User.isActive when Employee.status changes to %s',
    async (status, isActive) => {
      const userUpdate = jest.fn().mockResolvedValue({});
      const employeeUpdate = jest.fn().mockResolvedValue({
        id: 7,
        status,
      });
      const transaction = jest.fn(async (callback) =>
        callback({
          user: { update: userUpdate },
          employee: { update: employeeUpdate },
        }),
      );
      const prisma = {
        employee: {
          findUnique: jest.fn().mockResolvedValue({
            id: 7,
            userId: 42,
            status: status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
            dateOfExit: null,
            user: { id: 42, email: 'employee@example.com' },
          }),
        },
        user: { findUnique: jest.fn() },
        $transaction: transaction,
      } as any;
      const service = new EmployeesService(prisma, {} as any, {} as any);

      await service.updateEmployee(7, { status } as any);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { isActive },
      });
      expect(employeeUpdate).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { status },
      });
    },
  );

  it('rolls back the User update when the Employee update fails', async () => {
    const committedState = { userIsActive: true, employeeStatus: 'ACTIVE' };
    const transactionState = { ...committedState };
    const userUpdate = jest.fn(async ({ data }: any) => {
      transactionState.userIsActive = data.isActive;
    });
    const employeeUpdate = jest.fn().mockRejectedValue(new Error('employee update failed'));
    const transaction = jest.fn(async (callback) => {
      try {
        return await callback({
          user: { update: userUpdate },
          employee: { update: employeeUpdate },
        });
      } catch (error) {
        transactionState.userIsActive = committedState.userIsActive;
        transactionState.employeeStatus = committedState.employeeStatus;
        throw error;
      }
    });
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          userId: 42,
          status: 'ACTIVE',
          dateOfExit: null,
          user: { id: 42, email: 'employee@example.com' },
        }),
      },
      user: { findUnique: jest.fn() },
      $transaction: transaction,
    } as any;
    const service = new EmployeesService(prisma, {} as any, {} as any);

    await expect(
      service.updateEmployee(7, { status: 'INACTIVE' } as any),
    ).rejects.toThrow('employee update failed');

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { isActive: false },
    });
    expect(employeeUpdate).toHaveBeenCalledTimes(1);
    expect(transactionState).toEqual(committedState);
  });
});
