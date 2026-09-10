import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  constructor(private readonly service: PerformanceService) {}

  @Post('goals')
  createGoal(@Body() body: CreatePerformanceGoalDto) {
    return this.service.createGoal(body);
  }

  @Get('goals')
  findGoals(@Query('employeeId') employeeId?: string) {
    return this.service.findGoals(employeeId);
  }

  @Get('goals/:id')
  findGoal(@Param('id') id: string) {
    return this.service.findGoal(id);
  }

  @Patch('goals/:id')
  updateGoal(@Param('id') id: string, @Body() body: UpdatePerformanceGoalDto) {
    return this.service.updateGoal(id, body);
  }

  @Delete('goals/:id')
  deleteGoal(@Param('id') id: string) {
    return this.service.deleteGoal(id);
  }

  @Post('reviews')
  createReview(@Body() body: CreateAppraisalReviewDto) {
    return this.service.createReview(body);
  }

  @Get('reviews')
  findReviews(@Query('employeeId') employeeId?: string) {
    return this.service.findReviews(employeeId);
  }

  @Get('reviews/:id')
  findReview(@Param('id') id: string) {
    return this.service.findReview(id);
  }

  @Patch('reviews/:id')
  updateReview(
    @Param('id') id: string,
    @Body() body: UpdateAppraisalReviewDto,
  ) {
    return this.service.updateReview(id, body);
  }

  @Delete('reviews/:id')
  deleteReview(@Param('id') id: string) {
    return this.service.deleteReview(id);
  }
}
