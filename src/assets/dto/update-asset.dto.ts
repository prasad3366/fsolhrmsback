import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
