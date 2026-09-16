import { ForbiddenException } from '@nestjs/common';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

describe('PerformanceController', () => {
  const service = {
    createGoal: jest.fn(),
    findGoals: jest.fn(),
    findGoal: jest.fn(),
    updateGoal: jest.fn(),
    deleteGoal: jest.fn(),
    createReview: jest.fn(),
    findReviews: jest.fn(),
    findReview: jest.fn(),
    updateReview: jest.fn(),
    deleteReview: jest.fn(),
  } as unknown as jest.Mocked<PerformanceService>;

  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    team: {
      findMany: jest.fn(),
    },
  };

  const mockActiveUser = (userId: number) => {
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      isActive: true,
      employee: { id: userId, status: 'ACTIVE' },
    });
  };

  let controller: PerformanceController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PerformanceController(service, prisma as any);
  });

  it('forwards all goal CRUD operations for authorized access', async () => {
    const body = { employeeId: '7', title: 'Goal', description: 'Goal desc', category: 'INDIVIDUAL' } as any;
    const result = { id: 'goal', employeeId: 7 };
    mockActiveUser(1);
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 1 });
    prisma.team.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    service.findGoal.mockResolvedValue({ id: 'goal', employeeId: 7 } as any);
    service.createGoal.mockResolvedValue(result as any);
    service.findGoals.mockResolvedValue([result] as any);
    service.updateGoal.mockResolvedValue(result as any);
    service.deleteGoal.mockResolvedValue({ message: 'deleted' });

    const req = { user: { id: 1, role: 'HR', employeeId: 9 } };

    await expect(controller.createGoal(req, body)).resolves.toBe(result);
    await expect(controller.findGoals(req, '7')).resolves.toEqual([result]);
    await expect(controller.findGoal(req, 'goal')).resolves.toEqual({ id: 'goal', employeeId: 7 });
    await expect(controller.updateGoal(req, 'goal', { title: 'Updated' })).resolves.toBe(result);
    await expect(controller.deleteGoal(req, 'goal')).resolves.toEqual({ message: 'deleted' });

    expect(service.createGoal).toHaveBeenCalledWith({ ...body, employeeId: '7' });
    expect(service.findGoals).toHaveBeenCalledWith('7');
    expect(service.updateGoal).toHaveBeenCalledWith('goal', { title: 'Updated' });
    expect(service.deleteGoal).toHaveBeenCalledWith('goal');
  });

  it('forwards all review CRUD operations for authorized access', async () => {
    const body = { employeeId: '7', reviewerId: 99, employeeName: 'Ada', cycleName: 'FY 2026' } as any;
    const result = { id: 'review', employeeId: 7, reviewerId: 9 };
    mockActiveUser(1);
    prisma.employee.findUnique.mockResolvedValue({ id: 7, teamId: 1 });
    prisma.team.findMany.mockResolvedValue([{ id: 1 }]);
    service.findReview.mockResolvedValue({ id: 'review', employeeId: 7 } as any);
    service.createReview.mockResolvedValue(result as any);
    service.findReviews.mockResolvedValue([result] as any);
    service.updateReview.mockResolvedValue(result as any);
    service.deleteReview.mockResolvedValue({ message: 'deleted' });

    const req = { user: { id: 1, role: 'HR', employeeId: 9 } };

    await expect(controller.createReview(req, body)).resolves.toBe(result);
    await expect(controller.findReviews(req, '7')).resolves.toEqual([result]);
    await expect(controller.findReview(req, 'review')).resolves.toEqual({ id: 'review', employeeId: 7 });
    await expect(controller.updateReview(req, 'review', { cycleName: 'FY 2027' })).resolves.toBe(result);
    await expect(controller.deleteReview(req, 'review')).resolves.toEqual({ message: 'deleted' });

    expect(service.createReview).toHaveBeenCalledWith({ ...body, employeeId: '7', reviewerId: 9 });
    expect(service.findReviews).toHaveBeenCalledWith('7');
    expect(service.updateReview).toHaveBeenCalledWith('review', { cycleName: 'FY 2027' });
    expect(service.deleteReview).toHaveBeenCalledWith('review');
  });

  it('denies employee access to another employee goal', async () => {
    const req = { user: { id: 1, role: 'EMPLOYEE', employeeId: 10 } };
    await expect(controller.findGoal(req, '999')).rejects.toThrow(ForbiddenException);
    await expect(controller.updateGoal(req, '999', { title: 'Nope' })).rejects.toThrow(ForbiddenException);
    await expect(controller.deleteGoal(req, '999')).rejects.toThrow(ForbiddenException);
  });

  it('denies employee cross-employee review mutation', async () => {
    const req = { user: { id: 1, role: 'EMPLOYEE', employeeId: 10 } };
    service.findReview.mockResolvedValue({ id: 'review', employeeId: 22 } as any);

    await expect(controller.findReview(req, 'review')).rejects.toThrow(ForbiddenException);
    await expect(controller.updateReview(req, 'review', { feedback: 'bad' })).rejects.toThrow(ForbiddenException);
    await expect(controller.deleteReview(req, 'review')).rejects.toThrow(ForbiddenException);
  });

  it('allows manager access only within the server-derived managed team', async () => {
    const req = { user: { id: 1, role: 'IT_MANAGER', employeeId: 9 } };
    mockActiveUser(1);
    prisma.employee.findUnique.mockResolvedValue({ id: 12, teamId: 5 });
    prisma.team.findMany.mockResolvedValue([{ id: 5 }]);
    service.findGoal.mockResolvedValue({ id: 'goal', employeeId: 12 } as any);

    await expect(controller.findGoal(req, 'goal')).resolves.toEqual({ id: 'goal', employeeId: 12 });

    prisma.team.findMany.mockResolvedValue([{ id: 90 }]);
    await expect(controller.findGoal(req, 'goal')).rejects.toThrow(ForbiddenException);
  });

  it('denies employee createGoal with a different employeeId payload', async () => {
    const req = { user: { id: 1, role: 'EMPLOYEE', employeeId: 10 } };
    await expect(
      controller.createGoal(req, {
        employeeId: '11',
        title: 'Goal',
        description: 'desc',
        category: 'INDIVIDUAL',
      } as any),
    ).rejects.toThrow(ForbiddenException);
  });
});
