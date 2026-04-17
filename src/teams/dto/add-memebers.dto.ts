import { IsArray, ArrayNotEmpty, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class AddMembersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  employeeIds!: number[];
}