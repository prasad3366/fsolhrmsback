import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PerformanceService } from './performance.service';
import {
  AppraisalReviewStatus,
  PerformanceGoalCategory,
  PerformanceGoalStatus,
} from './dto/performance.dto';

type MockMethod = jest.MockedFunction<(...args: never[]) => Promise<unknown>>;

const createMockMethod = (): MockMethod => jest.fn() as unknown as MockMethod;

describe('PerformanceService', () => {
  const prisma = {
    performanceGoal: {
      create: createMockMethod(),
      findMany: createMockMethod(),
      findUnique: createMockMethod(),
      update: createMockMethod(),
      delete: createMockMethod(),
    },
    appraisalReview: {
      create: createMockMethod(),
      findMany: createMockMethod(),
      findUnique: createMockMethod(),
      update: createMockMethod(),
      delete: createMockMethod(),
    },
  };
  const goalId = 1;
  const employeeId = '2';
  const reviewerId = 3;
  const reviewId = 4;
  let service: PerformanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PerformanceService(prisma as unknown as PrismaService);
  });

  it('creates a performance goal with numeric employee ID', async () => {
    const result = { id: goalId };
    prisma.performanceGoal.create.mockResolvedValue(result);

    await expect(
      service.createGoal({
        employeeId,
        title: 'Improve delivery',
        description: 'Reduce cycle time',
        category: PerformanceGoalCategory.INDIVIDUAL,
        status: PerformanceGoalStatus.IN_PROGRESS,
        progress: 40,
        dueDate: '2026-12-31T00:00:00.000Z',
      }),
    ).resolves.toBe(result);

    expect(prisma.performanceGoal.create).toHaveBeenCalledWith({
      data: {
        employeeId: 2,
        title: 'Improve delivery',
        description: 'Reduce cycle time',
        category: PerformanceGoalCategory.INDIVIDUAL,
        status: PerformanceGoalStatus.IN_PROGRESS,
        progress: 40,
      },
    });
  });

  it('lists all goals or filters by employee', async () => {
    prisma.performanceGoal.findMany.mockResolvedValue([]);

    await service.findGoals();
    await service.findGoals(employeeId);

    expect(prisma.performanceGoal.findMany).toHaveBeenNthCalledWith(1, {
      where: undefined,
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.performanceGoal.findMany).toHaveBeenNthCalledWith(2, {
      where: { employeeId: 2 },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('gets and updates a goal with a numeric ID', async () => {
    const goal = { id: goalId };
    prisma.performanceGoal.findUnique.mockResolvedValue(goal);
    prisma.performanceGoal.update.mockResolvedValue({ ...goal, progress: 100 });

    await expect(service.findGoal(String(goalId))).resolves.toBe(goal);
    await expect(
      service.updateGoal(String(goalId), {
        title: 'Updated',
        description: 'Updated description',
        category: PerformanceGoalCategory.TEAM,
        status: PerformanceGoalStatus.COMPLETED,
        progress: 100,
      }),
    ).resolves.toEqual({ ...goal, progress: 100 });

    expect(prisma.performanceGoal.update).toHaveBeenCalledWith({
      where: { id: goalId },
      data: {
        title: 'Updated',
        description: 'Updated description',
        category: PerformanceGoalCategory.TEAM,
        status: PerformanceGoalStatus.COMPLETED,
        progress: 100,
      },
    });
  });

  it('rejects missing goals and deletes existing goals', async () => {
    prisma.performanceGoal.findUnique.mockResolvedValue(null);
    await expect(service.findGoal(String(goalId))).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.updateGoal(String(goalId), { progress: 10 }),
    ).rejects.toThrow('Performance goal not found');
    await expect(service.deleteGoal(String(goalId))).rejects.toThrow(
      'Performance goal not found',
    );

    prisma.performanceGoal.findUnique.mockResolvedValue({ id: goalId });
    await expect(service.deleteGoal(String(goalId))).resolves.toEqual({
      message: 'Performance goal deleted successfully',
    });
    expect(prisma.performanceGoal.delete).toHaveBeenCalledWith({
      where: { id: goalId },
    });
  });

  it('creates a review with numeric employee and reviewer IDs', async () => {
    const result = { id: reviewId };
    prisma.appraisalReview.create.mockResolvedValue(result);

    await expect(
      service.createReview({
        employeeId,
        reviewerId,
        employeeName: 'Ada Lovelace',
        cycleName: 'FY 2026',
        status: AppraisalReviewStatus.IN_REVIEW,
        rating: 4,
        feedback: 'Strong ownership',
      }),
    ).resolves.toBe(result);

    expect(prisma.appraisalReview.create).toHaveBeenCalledWith({
      data: {
        employeeId: 2,
        reviewerId,
        cycleName: 'FY 2026',
        status: AppraisalReviewStatus.IN_REVIEW,
        rating: 4,
        feedback: 'Strong ownership',
      },
    });
  });

  it('lists reviews with optional employee filtering', async () => {
    prisma.appraisalReview.findMany.mockResolvedValue([]);

    await service.findReviews();
    await service.findReviews(employeeId);

    expect(prisma.appraisalReview.findMany).toHaveBeenNthCalledWith(1, {
      where: undefined,
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.appraisalReview.findMany).toHaveBeenNthCalledWith(2, {
      where: { employeeId: 2 },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('gets and updates a review with a numeric ID', async () => {
    const review = { id: reviewId };
    prisma.appraisalReview.findUnique.mockResolvedValue(review);
    prisma.appraisalReview.update.mockResolvedValue({
      ...review,
      status: AppraisalReviewStatus.COMPLETED,
    });

    await expect(service.findReview(String(reviewId))).resolves.toBe(review);
    await expect(
      service.updateReview(String(reviewId), {
        cycleName: 'FY 2027',
        status: AppraisalReviewStatus.COMPLETED,
        rating: 5,
        feedback: 'Excellent',
      }),
    ).resolves.toEqual({
      ...review,
      status: AppraisalReviewStatus.COMPLETED,
    });

    expect(prisma.appraisalReview.update).toHaveBeenCalledWith({
      where: { id: reviewId },
      data: {
        cycleName: 'FY 2027',
        status: AppraisalReviewStatus.COMPLETED,
        rating: 5,
        feedback: 'Excellent',
      },
    });
  });

  it('rejects missing reviews and deletes existing reviews', async () => {
    prisma.appraisalReview.findUnique.mockResolvedValue(null);
    await expect(service.findReview(String(reviewId))).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.updateReview(String(reviewId), { feedback: 'Updated' }),
    ).rejects.toThrow('Appraisal review not found');
    await expect(service.deleteReview(String(reviewId))).rejects.toThrow(
      'Appraisal review not found',
    );

    prisma.appraisalReview.findUnique.mockResolvedValue({ id: reviewId });
    await expect(service.deleteReview(String(reviewId))).resolves.toEqual({
      message: 'Appraisal review deleted successfully',
    });
    expect(prisma.appraisalReview.delete).toHaveBeenCalledWith({
      where: { id: reviewId },
    });
  });
});
