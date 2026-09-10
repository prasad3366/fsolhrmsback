import { IsInt, Min } from 'class-validator';

export class AssignAssetDto {
  @IsInt()
  @Min(1)
  assetId!: number;

  @IsInt()
  @Min(1)
  employeeId!: number;
}