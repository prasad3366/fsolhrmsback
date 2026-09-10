import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type AuthorizationUser = {
  id: number;
  role: string;
  employeeId?: number | null;
  email?: string;
};

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  canAccessOrganizationWide(
    user: AuthorizationUser | undefined,
    scope:
      | 'employee'
      | 'attendance'
      | 'leave'
      | 'documents'
      | 'helpdesk'
      | 'assets'
      | 'dashboard'
      | 'salary'
      | 'team' = 'employee',
  ): boolean {
    if (!user) {
      return false;
    }

    const normalizedRole = this.normalizeRole(user.role);

    if (scope === 'documents') {
      return ['SUPER_ADMIN', 'CEO', 'HR'].includes(normalizedRole);
    }

    if (
      normalizedRole === 'SUPER_ADMIN' ||
      normalizedRole === 'ADMIN' ||
      normalizedRole === 'CEO' ||
      normalizedRole === 'HR'
    ) {
      return true;
    }

    if (scope === 'employee' && normalizedRole === 'FINANCE_MANAGER') {
      return true;
    }

    if ((scope === 'salary' || scope === 'dashboard') && normalizedRole === 'FINANCE_MANAGER') {
      return true;
    }

    return false;
  }

  private normalizeRole(role: string | undefined): string {
    return String(role ?? '').toUpperCase();
  }

  canManageWfh(user: AuthorizationUser | undefined): boolean {
    if (!user) {
      return false;
    }

    return [
      'SUPER_ADMIN',
      'ADMIN',
      'CEO',
      'HR',
      'IT_MANAGER',
      'SALES_MANAGER',
    ].includes(this.normalizeRole(user.role));
  }

  canManageWfhOrganizationWide(user: AuthorizationUser | undefined): boolean {
    if (!user) {
      return false;
    }

    return ['SUPER_ADMIN', 'ADMIN', 'CEO', 'HR'].includes(this.normalizeRole(user.role));
  }

  async getWfhManagedTeamIds(user: AuthorizationUser | undefined): Promise<number[]> {
    if (!user || !['IT_MANAGER', 'SALES_MANAGER'].includes(this.normalizeRole(user.role))) {
      return [];
    }

    const managerEmployeeId = Number(user.employeeId);
    if (!Number.isInteger(managerEmployeeId) || managerEmployeeId <= 0) {
      return [];
    }

    const managedTeams = await this.prisma.team.findMany({
      where: { managerId: managerEmployeeId },
      select: { id: true },
    });

    return managedTeams.map((team) => Number(team.id));
  }

  async canManageWfhRequest(
    user: AuthorizationUser | undefined,
    requestId: number,
  ): Promise<boolean> {
    if (!this.canManageWfh(user)) {
      return false;
    }

    if (this.canManageWfhOrganizationWide(user)) {
      return true;
    }

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return false;
    }

    const request = await this.prisma.wFHRequest.findUnique({
      where: { id: requestId },
      select: { employeeId: true },
    });

    if (!request) {
      return false;
    }

    return this.canAccessEmployee(user, request.employeeId);
  }

  private async getEmployeeTeamContext(employeeId: number | null | undefined) {
    if (!employeeId) {
      return null;
    }

    return this.prisma.employee.findUnique({
      where: { id: Number(employeeId) },
      select: {
        id: true,
        teamId: true,
        team: {
          select: {
            id: true,
            name: true,
            managerId: true,
          },
        },
      },
    });
  }

  async canAccessEmployee(
    user: AuthorizationUser | undefined,
    targetEmployeeId: number | string,
  ): Promise<boolean> {
    if (!user) {
      return false;
    }

    const targetId = Number(targetEmployeeId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return false;
    }

    const normalizedRole = this.normalizeRole(user.role);

    if (
      normalizedRole === 'SUPER_ADMIN' ||
      normalizedRole === 'CEO' ||
      normalizedRole === 'HR' ||
      normalizedRole === 'FINANCE_MANAGER'
    ) {
      return true;
    }

    if (normalizedRole === 'EMPLOYEE') {
      return Number(user.employeeId) === targetId;
    }

    if (normalizedRole === 'IT_MANAGER' || normalizedRole === 'SALES_MANAGER') {
      const managerEmployeeId = Number(user.employeeId);
      if (!managerEmployeeId) {
        return false;
      }

      const targetEmployee = await this.getEmployeeTeamContext(targetId);
      if (!targetEmployee || targetEmployee.teamId === null || targetEmployee.teamId === undefined) {
        return false;
      }

      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: managerEmployeeId },
        select: { id: true },
      });

      if (!managedTeams.length) {
        return false;
      }

      return managedTeams.some((team) => Number(team.id) === Number(targetEmployee.teamId));
    }

    return false;
  }

  async canAccessTeam(
    user: AuthorizationUser | undefined,
    targetTeamId: number | string,
  ): Promise<boolean> {
    if (!user) {
      return false;
    }

    const targetId = Number(targetTeamId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return false;
    }

    const normalizedRole = this.normalizeRole(user.role);

    if (
      normalizedRole === 'SUPER_ADMIN' ||
      normalizedRole === 'CEO' ||
      normalizedRole === 'HR' ||
      normalizedRole === 'FINANCE_MANAGER'
    ) {
      return true;
    }

    if (normalizedRole === 'EMPLOYEE') {
      return false;
    }

    if (normalizedRole === 'IT_MANAGER' || normalizedRole === 'SALES_MANAGER') {
      const managerEmployeeId = Number(user.employeeId);
      if (!managerEmployeeId) {
        return false;
      }

      const team = await this.prisma.team.findUnique({
        where: { id: targetId },
        select: { id: true, managerId: true },
      });

      if (!team) {
        return false;
      }

      return Number(team.managerId) === managerEmployeeId;
    }

    return false;
  }

  async canAccessResource(
    user: AuthorizationUser | undefined,
    resource: Record<string, any> | undefined,
  ): Promise<boolean> {
    if (!user || !resource) {
      return false;
    }

    const targetEmployeeId =
      resource.employeeId ??
      resource.employee?.id ??
      resource.assigneeEmployeeId ??
      resource.targetEmployeeId;

    if (targetEmployeeId !== undefined && targetEmployeeId !== null) {
      return this.canAccessEmployee(user, targetEmployeeId);
    }

    const targetTeamId =
      resource.teamId ?? resource.team?.id ?? resource.targetTeamId;

    if (targetTeamId !== undefined && targetTeamId !== null) {
      return this.canAccessTeam(user, targetTeamId);
    }

    const normalizedRole = this.normalizeRole(user.role);
    if (
      normalizedRole === 'SUPER_ADMIN' ||
      normalizedRole === 'CEO' ||
      normalizedRole === 'HR' ||
      normalizedRole === 'FINANCE_MANAGER'
    ) {
      return true;
    }

    return false;
  }
}
