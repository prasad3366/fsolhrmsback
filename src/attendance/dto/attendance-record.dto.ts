import { Type } from 'class-transformer';
import { AttendanceStatus, RegularizationStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class RegularizationDto {
  @IsDateString()
  requestedClockIn!: string;

  @IsDateString()
  requestedClockOut!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class ProcessRegularizationDto {
  @IsEnum(RegularizationStatus)
  status!: RegularizationStatus;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class AttendanceHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  year?: number;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  pageSize?: number;
}
