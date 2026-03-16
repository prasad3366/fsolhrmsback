import { IsDateString, IsOptional, IsString } from 'class-validator';

export class RequestWfhDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
