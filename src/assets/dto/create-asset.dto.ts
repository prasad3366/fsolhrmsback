import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateAssetDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  assignedTo?: number;
}