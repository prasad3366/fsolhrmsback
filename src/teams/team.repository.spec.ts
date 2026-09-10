import { BadRequestException } from '@nestjs/common';
import { TeamRepository } from './team.repository';

describe('TeamRepository.createWithMembers', () => {
  const team = { id: 7, manager: {}, members: [] };
  const data = { name: 'IT', managerId: 1 };

  const createRepository = (employees: any[], updateCount = employees.length) => {
    const state = {
      employees: [...employees],
      teams: [] as any[],
    };
    const transaction = jest.fn(async (callback: any) => {
      const snapshot = {
        employees: state.employees.map((employee) => ({ ...employee })),
        teams: [...state.teams],
      };
      const tx = {
        employee: {
          findMany: jest.fn(async () =>
            state.employees
              .filter((employee) => employee.teamId === null)
              .map((employee) => ({ id: employee.id })),
          ),
          updateMany: jest.fn(async () => {
            if (updateCount !== employees.length) {
              return { count: updateCount };
            }
            state.employees.forEach((employee) => {
              employee.teamId = team.id;
            });
            return { count: updateCount };
          }),
        },
        team: {
          create: jest.fn(async () => {
            state.teams.push(team);
            return team;
          }),
        },
      };

      try {
        return await callback(tx);
      } catch (error) {
        state.employees = snapshot.employees;
        state.teams = snapshot.teams;
        throw error;
      }
    });

    return {
      repository: new TeamRepository({ $transaction: transaction } as any),
      state,
      transaction,
    };
  };

  it('assigns all valid members in the same transaction', async () => {
    const { repository, state, transaction } = createRepository([
      { id: 10, teamId: null },
      { id: 11, teamId: null },
    ]);

    await expect(repository.createWithMembers(data, [10, 11])).resolves.toEqual(team);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(state.teams).toHaveLength(1);
    expect(state.employees.every((employee) => employee.teamId === team.id)).toBe(true);
  });

  it.each([
    ['nonexistent', [{ id: 10, teamId: null }], [10, 12]],
    ['already-assigned', [{ id: 10, teamId: 9 }], [10]],
  ])('rejects %s members before creating a team', async (_label, employees, ids) => {
    const { repository, state } = createRepository(employees);

    await expect(repository.createWithMembers(data, ids)).rejects.toThrow(BadRequestException);

    expect(state.teams).toHaveLength(0);
  });

  it('rejects mixed valid and invalid members without partial assignment', async () => {
    const { repository, state } = createRepository([{ id: 10, teamId: null }]);

    await expect(repository.createWithMembers(data, [10, 12])).rejects.toThrow(BadRequestException);

    expect(state.teams).toHaveLength(0);
    expect(state.employees[0].teamId).toBeNull();
  });

  it('rolls back the team when assignment count is incomplete', async () => {
    const { repository, state } = createRepository([{ id: 10, teamId: null }], 0);

    await expect(repository.createWithMembers(data, [10])).rejects.toThrow(BadRequestException);

    expect(state.teams).toHaveLength(0);
    expect(state.employees[0].teamId).toBeNull();
  });
});

describe('TeamRepository batch membership operations', () => {
  const createRepository = (employees: any[], mutationCount?: number) => {
    const state = { employees: employees.map((employee) => ({ ...employee })) };
    const transaction = jest.fn(async (callback: any) => {
      const snapshot = state.employees.map((employee) => ({ ...employee }));
      const tx = {
        employee: {
          findMany: jest.fn(async (args: any) =>
            state.employees
              .filter(
                (employee) =>
                  args.where.id.in.includes(employee.id) &&
                  employee.teamId === args.where.teamId,
              )
              .map((employee) => ({ id: employee.id })),
          ),
          updateMany: jest.fn(async (args: any) => {
            const count = mutationCount ?? args.where.id.in.length;
            let updated = 0;
            state.employees.forEach((employee) => {
              if (
                updated < count &&
                args.where.id.in.includes(employee.id) &&
                employee.teamId === args.where.teamId
              ) {
                employee.teamId = args.data.teamId;
                updated += 1;
              }
            });
            return { count };
          }),
        },
      };

      try {
        return await callback(tx);
      } catch (error) {
        state.employees = snapshot;
        throw error;
      }
    });

    return {
      repository: new TeamRepository({ $transaction: transaction } as any),
      state,
    };
  };

  it('adds all valid members atomically', async () => {
    const { repository, state } = createRepository([
      { id: 10, teamId: null },
      { id: 11, teamId: null },
    ]);

    await expect(repository.addMembers(7, [10, 11])).resolves.toEqual({ count: 2 });
    expect(state.employees.map((employee) => employee.teamId)).toEqual([7, 7]);
  });

  it.each([
    [[{ id: 10, teamId: null }], [10, 12]],
    [[{ id: 10, teamId: null }, { id: 12, teamId: 9 }], [10, 12]],
  ])('rejects invalid add batches without changing members', async (employees, ids) => {
    const { repository, state } = createRepository(employees);

    await expect(repository.addMembers(7, ids)).rejects.toThrow(BadRequestException);
    expect(state.employees).toEqual(employees);
  });

  it('removes all valid members atomically', async () => {
    const { repository, state } = createRepository([
      { id: 10, teamId: 7 },
      { id: 11, teamId: 7 },
    ]);

    await expect(repository.removeMembers(7, [10, 11])).resolves.toEqual({ count: 2 });
    expect(state.employees.map((employee) => employee.teamId)).toEqual([null, null]);
  });

  it('rejects invalid remove batches without changing members', async () => {
    const employees = [{ id: 10, teamId: 7 }, { id: 11, teamId: 9 }];
    const { repository, state } = createRepository(employees);

    await expect(repository.removeMembers(7, [10, 11])).rejects.toThrow(BadRequestException);
    expect(state.employees).toEqual(employees);
  });

  it('rolls back a batch when mutation count is incomplete', async () => {
    const employees = [{ id: 10, teamId: null }, { id: 11, teamId: null }];
    const { repository, state } = createRepository(employees, 1);

    await expect(repository.addMembers(7, [10, 11])).rejects.toThrow(BadRequestException);
    expect(state.employees).toEqual(employees);
  });
});