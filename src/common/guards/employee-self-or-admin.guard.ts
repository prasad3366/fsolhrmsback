import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AuthorizationService } from '../authorization/authorization.service';

@Injectable()
export class EmployeeSelfOrAdminGuard implements CanActivate {
  constructor(private readonly authorizationService: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const employeeId = request.params?.id;

    if (!employeeId) {
      throw new ForbiddenException('Employee identifier is required');
    }

    const hasAccess = await this.authorizationService.canAccessEmployee(
      user,
      employeeId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('Access denied for this employee');
    }

    return true;
  }
}
