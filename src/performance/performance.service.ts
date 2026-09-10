import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAppraisalReviewDto,
  CreatePerformanceGoalDto,
  UpdateAppraisalReviewDto,
  UpdatePerformanceGoalDto,
} from './dto/performance.dto';

@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  createGoal(data: CreatePerformanceGoalDto) {
    return this.prisma.performanceGoal.create({
      data: {
        employeeId: Number(data.employeeId),
        title: data.title,
        description: data.description,
        category: data.category,
        status: data.status,
        progress: data.progress,
      },
    });
  }

  findGoals(employeeId?: number | string) {
    return this.prisma.performanceGoal.findMany({
      where: employeeId ? { employeeId: Number(employeeId) } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findGoal(id: number | string) {
    const goal = await this.prisma.performanceGoal.findUnique({
      where: { id: Number(id) },
    });
    if (!goal) throw new NotFoundException('Performance goal not found');
    return goal;
  }

  async updateGoal(id: number | string, data: UpdatePerformanceGoalDto) {
    await this.findGoal(id);
    return this.prisma.performanceGoal.update({
      where: { id: Number(id) },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.progress !== undefined && { progress: data.progress }),
      },
    });
  }

  async deleteGoal(id: number | string) {
    await this.findGoal(id);
    await this.prisma.performanceGoal.delete({ where: { id: Number(id) } });
    return { message: 'Performance goal deleted successfully' };
  }

  createReview(data: CreateAppraisalReviewDto) {
    return this.prisma.appraisalReview.create({
      data: {
        employeeId: Number(data.employeeId),
        reviewerId: Number(data.reviewerId),
        cycleName: data.cycleName,
        status: data.status,
        rating: data.rating,
        feedback: data.feedback,
      },
    });
  }

  findReviews(employeeId?: number | string) {
    return this.prisma.appraisalReview.findMany({
      where: employeeId ? { employeeId: Number(employeeId) } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findReview(id: number | string) {
    const review = await this.prisma.appraisalReview.findUnique({
      where: { id: Number(id) },
    });
    if (!review) throw new NotFoundException('Appraisal review not found');
    return review;
  }

  async updateReview(id: number | string, data: UpdateAppraisalReviewDto) {
    await this.findReview(id);
    return this.prisma.appraisalReview.update({
      where: { id: Number(id) },
      data: {
        ...(data.cycleName !== undefined && { cycleName: data.cycleName }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.rating !== undefined && { rating: data.rating }),
        ...(data.feedback !== undefined && { feedback: data.feedback }),
      },
    });
  }

  async deleteReview(id: number | string) {
    await this.findReview(id);
    await this.prisma.appraisalReview.delete({ where: { id: Number(id) } });
    return { message: 'Appraisal review deleted successfully' };
  }
}
