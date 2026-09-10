import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PERMISSION_KEY,
  PermissionAction,
  ROLES_KEY,
} from '../decorators/roles.decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const permission = this.reflector.getAllAndOverride<{
      moduleName: string;
      action: PermissionAction;
    }>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles?.length && !permission) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException('User not authenticated');

    const normalizedUserRole = String(user.role ?? '').trim().toUpperCase();
    const normalizedRequiredRoles = (requiredRoles ?? []).map((role) =>
      String(role).trim().toUpperCase(),
    );

    if (permission) {
      try {
        const access = await this.prisma.rolePermission.findUnique({
          where: {
            roleName_moduleName: {
              roleName: normalizedUserRole,
              moduleName: permission.moduleName,
            },
          },
        });
        if (access) return Boolean(access[permission.action]);
      } catch {
        // Use decorator roles if permissions are unavailable or unseeded.
      }
    }

    if (!normalizedRequiredRoles.includes(normalizedUserRole)) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${(requiredRoles ?? []).join(', ')}`,
      );
    }

    return true;
  }
}
