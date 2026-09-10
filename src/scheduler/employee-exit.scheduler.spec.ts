import { EmployeeExitScheduler } from './employee-exit.scheduler';

describe('EmployeeExitScheduler', () => {
  const employee = {
    id: 7,
    userId: 42,
    firstName: 'Example',
    lastName: 'Employee',
    dateOfExit: new Date('2026-09-01T00:00:00.000Z'),
  };

  it('deactivates the User and Employee in one transaction', async () => {
    const userUpdate = jest.fn().mockResolvedValue({});
    const employeeUpdate = jest.fn().mockResolvedValue({});
    const transaction = jest.fn(async (callback) =>
      callback({
        user: { update: userUpdate },
        employee: { update: employeeUpdate },
      }),
    );
    const employeeFindMany = jest.fn().mockResolvedValue([employee]);
    const scheduler = new EmployeeExitScheduler({
      employee: { findMany: employeeFindMany },
      $transaction: transaction,
    } as any);

    await scheduler.handleEmployeeExitDates();

    expect(employeeFindMany).toHaveBeenCalledWith({
      where: {
        dateOfExit: { lte: expect.any(Date) },
        user: { isActive: true },
      },
      include: { user: true },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: employee.userId },
      data: { isActive: false },
    });
    expect(employeeUpdate).toHaveBeenCalledWith({
      where: { id: employee.id },
      data: { status: 'INACTIVE' },
    });
  });

  it('leaves employees with unreached exit dates unchanged', async () => {
    const employeeFindMany = jest.fn().mockResolvedValue([]);
    const transaction = jest.fn();
    const scheduler = new EmployeeExitScheduler({
      employee: { findMany: employeeFindMany },
      $transaction: transaction,
    } as any);

    await scheduler.handleEmployeeExitDates();

    expect(transaction).not.toHaveBeenCalled();
  });

  it('rolls back both lifecycle updates when the transaction fails', async () => {
    const committedState = { userIsActive: true, employeeStatus: 'ACTIVE' };
    const transactionState = { ...committedState };
    const userUpdate = jest.fn(async () => {
      transactionState.userIsActive = false;
    });
    const employeeUpdate = jest.fn().mockRejectedValue(new Error('update failed'));
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
    const scheduler = new EmployeeExitScheduler({
      employee: { findMany: jest.fn().mockResolvedValue([employee]) },
      $transaction: transaction,
    } as any);

    await scheduler.handleEmployeeExitDates();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(employeeUpdate).toHaveBeenCalledTimes(1);
    expect(transactionState).toEqual(committedState);
  });
});