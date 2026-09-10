import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  AppraisalReviewStatus,
  PerformanceGoalCategory,
  PerformanceGoalStatus,
} from '@prisma/client';

export {
  AppraisalReviewStatus,
  PerformanceGoalCategory,
  PerformanceGoalStatus,
} from '@prisma/client';

export class CreatePerformanceGoalDto {
  @IsUUID()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsEnum(PerformanceGoalCategory)
  category!: PerformanceGoalCategory;

  @IsOptional()
  @IsEnum(PerformanceGoalStatus)
  status?: PerformanceGoalStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsDateString()
  dueDate!: string;
}

export class UpdatePerformanceGoalDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsOptional()
  @IsEnum(PerformanceGoalCategory)
  category?: PerformanceGoalCategory;

  @IsOptional()
  @IsEnum(PerformanceGoalStatus)
  status?: PerformanceGoalStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class CreateAppraisalReviewDto {
  @IsUUID()
  employeeId!: string;

  @IsNumber()
  @IsNotEmpty()
  reviewerId!: number;

  @IsString()
  @IsNotEmpty()
  employeeName!: string;

  @IsString()
  @IsNotEmpty()
  cycleName!: string;

  @IsOptional()
  @IsEnum(AppraisalReviewStatus)
  status?: AppraisalReviewStatus;

  @IsNumber()
  @IsOptional()
  rating?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  selfRating?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  managerRating?: number;

  @IsOptional()
  @IsString()
  feedback?: string;
}

export class UpdateAppraisalReviewDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  employeeName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cycleName?: string;

  @IsOptional()
  @IsEnum(AppraisalReviewStatus)
  status?: AppraisalReviewStatus;

  @IsNumber()
  @IsOptional()
  rating?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  selfRating?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  managerRating?: number;

  @IsOptional()
  @IsString()
  feedback?: string;
}
