import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EnrollmentStatus } from '@prisma/client';

export class UpdateEnrollmentDto {
  @IsEnum(EnrollmentStatus)
  status!: EnrollmentStatus;

  @IsOptional()
  @IsString()
  feedback?: string;
}
