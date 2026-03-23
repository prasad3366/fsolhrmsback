import { LeaveDurationType } from '@prisma/client';
import {
  IsInt,
  IsDateString,
  IsOptional,
  IsString,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLeaveDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  leaveTypeId: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsEnum(LeaveDurationType)
  durationType?: LeaveDurationType;

  @IsString()
  reason: string;
}
