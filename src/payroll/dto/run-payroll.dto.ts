import { IsInt, Min, Max, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class RunPayrollDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  employeeId?: number;

  @IsString()
  @IsOptional()
  empCode?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  year!: number;
}
