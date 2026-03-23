import { IsInt, Min, IsOptional, IsString } from 'class-validator';

export class RunPayrollDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  employeeId?: number;

  @IsString()
  @IsOptional()
  empCode?: string;

  @IsInt()
  @Min(1)
  month: number;

  @IsInt()
  year: number;
}
