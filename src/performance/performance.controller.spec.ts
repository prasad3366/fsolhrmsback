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
  let controller: PerformanceController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PerformanceController(service);
  });

  it('forwards all goal CRUD operations', async () => {
    const body = { title: 'Goal' } as any;
    const result = { id: 'goal' };
    service.createGoal.mockResolvedValue(result as any);
    service.findGoals.mockResolvedValue([result] as any);
    service.findGoal.mockResolvedValue(result as any);
    service.updateGoal.mockResolvedValue(result as any);
    service.deleteGoal.mockResolvedValue({ message: 'deleted' });

    await expect(controller.createGoal(body)).resolves.toBe(result);
    await expect(controller.findGoals()).resolves.toEqual([result]);
    await expect(controller.findGoals('employee')).resolves.toEqual([result]);
    await expect(controller.findGoal('goal')).resolves.toBe(result);
    await expect(controller.updateGoal('goal', body)).resolves.toBe(result);
    await expect(controller.deleteGoal('goal')).resolves.toEqual({ message: 'deleted' });

    expect(service.createGoal).toHaveBeenCalledWith(body);
    expect(service.findGoals).toHaveBeenNthCalledWith(1, undefined);
    expect(service.findGoals).toHaveBeenNthCalledWith(2, 'employee');
    expect(service.findGoal).toHaveBeenCalledWith('goal');
    expect(service.updateGoal).toHaveBeenCalledWith('goal', body);
    expect(service.deleteGoal).toHaveBeenCalledWith('goal');
  });

  it('forwards all review CRUD operations', async () => {
    const body = { cycleName: 'FY 2026' } as any;
    const result = { id: 'review' };
    service.createReview.mockResolvedValue(result as any);
    service.findReviews.mockResolvedValue([result] as any);
    service.findReview.mockResolvedValue(result as any);
    service.updateReview.mockResolvedValue(result as any);
    service.deleteReview.mockResolvedValue({ message: 'deleted' });

    await expect(controller.createReview(body)).resolves.toBe(result);
    await expect(controller.findReviews()).resolves.toEqual([result]);
    await expect(controller.findReviews('employee')).resolves.toEqual([result]);
    await expect(controller.findReview('review')).resolves.toBe(result);
    await expect(controller.updateReview('review', body)).resolves.toBe(result);
    await expect(controller.deleteReview('review')).resolves.toEqual({ message: 'deleted' });

    expect(service.createReview).toHaveBeenCalledWith(body);
    expect(service.findReviews).toHaveBeenNthCalledWith(1, undefined);
    expect(service.findReviews).toHaveBeenNthCalledWith(2, 'employee');
    expect(service.findReview).toHaveBeenCalledWith('review');
    expect(service.updateReview).toHaveBeenCalledWith('review', body);
    expect(service.deleteReview).toHaveBeenCalledWith('review');
  });
});
