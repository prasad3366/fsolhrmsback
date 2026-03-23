import { IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class PunchDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;
}
