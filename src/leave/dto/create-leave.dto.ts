import { LeaveDurationType } from '@prisma/client';
import {
  IsInt,
  IsDateString,
  IsOptional,
  IsString,
  IsEnum,
  Min,
  IsBoolean,
  IsNotEmpty,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLeaveDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  leaveTypeId!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsEnum(LeaveDurationType)
  durationType?: LeaveDurationType;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  medicalCertificate?: string;

  @IsOptional()
  @IsString()
  medicalCertificateFileName?: string;

  @IsOptional()
  @IsBoolean()
  isEmergency?: boolean;
}
