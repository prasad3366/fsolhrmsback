import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateRolePermissionDto {
  @IsOptional()
  @IsString()
  roleName?: string;

  @IsOptional()
  @IsString()
  moduleName?: string;

  @IsOptional()
  @IsBoolean()
  canView?: boolean;

  @IsOptional()
  @IsBoolean()
  canCreate?: boolean;

  @IsOptional()
  @IsBoolean()
  canEdit?: boolean;

  @IsOptional()
  @IsBoolean()
  canDelete?: boolean;

  @IsOptional()
  @IsBoolean()
  canApprove?: boolean;

  @IsOptional()
  @IsBoolean()
  canExport?: boolean;
}
