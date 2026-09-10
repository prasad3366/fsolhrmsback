import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const PERMISSION_KEY = 'permission';
export type PermissionAction =
	| 'canView'
	| 'canCreate'
	| 'canEdit'
	| 'canDelete'
	| 'canApprove'
	| 'canExport';

export const Permission = (moduleName: string, action: PermissionAction) =>
	SetMetadata(PERMISSION_KEY, { moduleName, action });
