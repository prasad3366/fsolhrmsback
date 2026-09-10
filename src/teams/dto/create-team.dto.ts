import {
  IsString,
  IsOptional,
  IsArray,
  ArrayNotEmpty,
  IsNumber,
  IsNotEmpty,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTeamDto {

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  managerId!: string; // empCode

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  employeeIds?: number[];
}