import { IsString, IsOptional, IsArray, ArrayNotEmpty, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTeamDto {

  @IsString()
  name!: string;

  @IsString()
  managerId!: string; // empCode

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  employeeIds?: number[];
}