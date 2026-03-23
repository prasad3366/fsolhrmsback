import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class EmployeeSelfOrAdminGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const employeeId = request.params.id;

    // ADMIN and HR can access any employee
    if (user.role === 'ADMIN' || user.role === 'HR') {
      return true;
    }

    // MANAGER can access any employee details (viewing only)
    if (user.role === 'MANAGER') {
      return true;
    }

    // EMPLOYEE can only access their own profile
    if (user.role === 'EMPLOYEE') {
      const userEmployeeId = user.employeeId;
      if (
        userEmployeeId &&
        userEmployeeId.toString() === employeeId.toString()
      ) {
        return true;
      }
      throw new ForbiddenException('You can only view your own profile');
    }

    throw new ForbiddenException('Access denied');
  }
}
