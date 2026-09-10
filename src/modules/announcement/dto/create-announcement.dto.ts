import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AnnouncementAudience, AnnouncementPriority } from '@prisma/client';

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(AnnouncementPriority)
  priority?: AnnouncementPriority;

  @IsOptional()
  @IsEnum(AnnouncementAudience)
  targetAudience?: AnnouncementAudience;

  @IsOptional()
  @Type(() => Number)
  teamId?: number;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}
