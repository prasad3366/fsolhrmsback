import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationService, type AuthorizationUser } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { PerformanceService } from './performance.service';
import {
  CreateAppraisalReviewDto,
  CreatePerformanceGoalDto,
  UpdateAppraisalReviewDto,
  UpdatePerformanceGoalDto,
} from './dto/performance.dto';

@Controller('performance')
@UseGuards(JwtAuthGuard)
export class PerformanceController {
  private readonly authorizationService: AuthorizationService;

  constructor(
    private readonly service: PerformanceService,
    private readonly prisma: PrismaService,
  ) {
    this.authorizationService = new AuthorizationService(this.prisma);
  }

  private requireAuthenticatedUser(req: any): AuthorizationUser {
    const user = req?.user as AuthorizationUser | undefined;
    if (!user || !user.role) {
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  }

  private hasOrgWidePerformanceAccess(user: AuthorizationUser): boolean {
    return this.authorizationService.canAccessOrganizationWide(user, 'employee');
  }

  private async assertTargetEmployeeAccess(
    req: any,
    employeeId: number | string,
  ): Promise<number> {
    const user = this.requireAuthenticatedUser(req);
    const targetEmployeeId = Number(employeeId);

    if (!Number.isInteger(targetEmployeeId) || targetEmployeeId <= 0) {
      throw new ForbiddenException('Access denied');
    }

    if (this.hasOrgWidePerformanceAccess(user)) {
      return targetEmployeeId;
    }

    if (String(user.role ?? '').toUpperCase() === 'EMPLOYEE') {
      if (Number(user.employeeId) !== targetEmployeeId) {
        throw new ForbiddenException('Access denied');
      }
      return targetEmployeeId;
    }

    if (!(await this.authorizationService.canAccessEmployee(user, targetEmployeeId))) {
      throw new ForbiddenException('Access denied');
    }

    return targetEmployeeId;
  }

  private async assertRecordAccess(req: any, employeeId: number | string): Promise<number> {
    return this.assertTargetEmployeeAccess(req, employeeId);
  }

  @Post('goals')
  async createGoal(@Req() req: any, @Body() body: CreatePerformanceGoalDto) {
    const employeeId = await this.assertTargetEmployeeAccess(req, body.employeeId);
    return this.service.createGoal({
      ...body,
      employeeId: String(employeeId),
    });
  }

  @Get('goals')
  async findGoals(@Req() req: any, @Query('employeeId') employeeId?: string) {
    const user = this.requireAuthenticatedUser(req);

    if (this.hasOrgWidePerformanceAccess(user)) {
      return this.service.findGoals(employeeId);
    }

    if (String(user.role ?? '').toUpperCase() === 'EMPLOYEE') {
      const selfEmployeeId = Number(user.employeeId);
      if (!Number.isInteger(selfEmployeeId) || selfEmployeeId <= 0) {
        throw new ForbiddenException('Access denied');
      }
      if (employeeId !== undefined && Number(employeeId) !== selfEmployeeId) {
        throw new ForbiddenException('Access denied');
      }
      return this.service.findGoals(String(selfEmployeeId));
    }

    if (employeeId === undefined) {
      throw new ForbiddenException('Access denied');
    }

    await this.assertTargetEmployeeAccess(req, employeeId);
    return this.service.findGoals(employeeId);
  }

  @Get('goals/:id')
  async findGoal(@Req() req: any, @Param('id') id: string) {
    const goal = await this.service.findGoal(id);
    await this.assertRecordAccess(req, goal.employeeId);
    return goal;
  }

  @Patch('goals/:id')
  async updateGoal(@Req() req: any, @Param('id') id: string, @Body() body: UpdatePerformanceGoalDto) {
    const goal = await this.service.findGoal(id);
    await this.assertRecordAccess(req, goal.employeeId);
    return this.service.updateGoal(id, body);
  }

  @Delete('goals/:id')
  async deleteGoal(@Req() req: any, @Param('id') id: string) {
    const goal = await this.service.findGoal(id);
    await this.assertRecordAccess(req, goal.employeeId);
    return this.service.deleteGoal(id);
  }

  @Post('reviews')
  async createReview(@Req() req: any, @Body() body: CreateAppraisalReviewDto) {
    const employeeId = await this.assertTargetEmployeeAccess(req, body.employeeId);
    const reviewerId = Number(this.requireAuthenticatedUser(req).employeeId);

    if (!Number.isInteger(reviewerId) || reviewerId <= 0) {
      throw new ForbiddenException('Access denied');
    }

    return this.service.createReview({
      ...body,
      employeeId: String(employeeId),
      reviewerId,
    });
  }

  @Get('reviews')
  async findReviews(@Req() req: any, @Query('employeeId') employeeId?: string) {
    const user = this.requireAuthenticatedUser(req);

    if (this.hasOrgWidePerformanceAccess(user)) {
      return this.service.findReviews(employeeId);
    }

    if (String(user.role ?? '').toUpperCase() === 'EMPLOYEE') {
      const selfEmployeeId = Number(user.employeeId);
      if (!Number.isInteger(selfEmployeeId) || selfEmployeeId <= 0) {
        throw new ForbiddenException('Access denied');
      }
      if (employeeId !== undefined && Number(employeeId) !== selfEmployeeId) {
        throw new ForbiddenException('Access denied');
      }
      return this.service.findReviews(String(selfEmployeeId));
    }

    if (employeeId === undefined) {
      throw new ForbiddenException('Access denied');
    }

    await this.assertTargetEmployeeAccess(req, employeeId);
    return this.service.findReviews(employeeId);
  }

  @Get('reviews/:id')
  async findReview(@Req() req: any, @Param('id') id: string) {
    const review = await this.service.findReview(id);
    await this.assertRecordAccess(req, review.employeeId);
    return review;
  }

  @Patch('reviews/:id')
  async updateReview(@Req() req: any, @Param('id') id: string, @Body() body: UpdateAppraisalReviewDto) {
    const review = await this.service.findReview(id);
    await this.assertRecordAccess(req, review.employeeId);
    return this.service.updateReview(id, body);
  }

  @Delete('reviews/:id')
  async deleteReview(@Req() req: any, @Param('id') id: string) {
    const review = await this.service.findReview(id);
    await this.assertRecordAccess(req, review.employeeId);
    return this.service.deleteReview(id);
  }
}
