import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';

export class EnrollEmployeesDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  trainingProgramId!: number;

  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  employeeIds!: number[];
}
