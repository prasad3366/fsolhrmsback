import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type AuthorizationUser = {
  id: number;
  role: string;
  employeeId?: number | null;
  email?: string;
  isActive?: boolean;
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

    if ((user as any).isActive === false) {
      return false;
    }

    const normalizedRole = this.normalizeRole(user.role);

    if (scope === 'documents') {
      return ['SUPER_ADMIN', 'CEO', 'HR'].includes(normalizedRole);
    }

    if (scope === 'employee' && normalizedRole === 'EMPLOYEE') {
      return true;
    }

    if (
      scope === 'employee' &&
      ['FINANCE_MANAGER', 'IT_MANAGER', 'SALES_MANAGER'].includes(normalizedRole)
    ) {
      return true;
    }

    if (
      normalizedRole === 'SUPER_ADMIN' ||
      normalizedRole === 'ADMIN' ||
      normalizedRole === 'CEO' ||
      normalizedRole === 'HR'
    ) {
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

    if (!user) {
      return false;
    }

    if (Number(user.employeeId) === Number(request.employeeId)) {
      return false;
    }

    return this.canAccessEmployee(user, request.employeeId);
  }

  private async hasActivePrincipal(user: AuthorizationUser | undefined): Promise<boolean> {
    if (!user || !user.id) {
      return false;
    }

    const currentUser = await this.prisma.user.findUnique({
      where: { id: Number(user.id) },
      select: {
        id: true,
        isActive: true,
        employee: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!currentUser || !currentUser.isActive) {
      return false;
    }

    if (currentUser.employee && currentUser.employee.status !== 'ACTIVE') {
      return false;
    }

    return true;
  }

  async canApproveOrRejectRequest(
    user: AuthorizationUser | undefined,
    targetEmployeeId: number | string,
  ): Promise<boolean> {
    if (!user) {
      return false;
    }

    if (!(await this.hasActivePrincipal(user))) {
      return false;
    }

    const targetId = Number(targetEmployeeId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return false;
    }

    const actorEmployeeId = Number(user.employeeId);
    const actorRole = this.normalizeRole(user.role);

    if (!Number.isInteger(actorEmployeeId) || actorEmployeeId <= 0) {
      return false;
    }

    if (targetId === actorEmployeeId) {
      return false;
    }

    const targetEmployee = await this.prisma.employee.findUnique({
      where: { id: targetId },
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
        user: {
          select: {
            role: true,
          },
        },
      },
    });

    if (!targetEmployee) {
      return false;
    }

    const targetRole = this.normalizeRole(targetEmployee.user?.role);
    const targetTeamName = String(targetEmployee.team?.name ?? '').toUpperCase();

    let allowedRoles: string[] = [];

    if (targetRole === 'EMPLOYEE') {
      if (targetTeamName === 'IT') {
        allowedRoles = ['IT_MANAGER', 'HR', 'SUPER_ADMIN', 'CEO'];
      } else if (targetTeamName === 'SALES') {
        allowedRoles = ['SALES_MANAGER', 'HR', 'SUPER_ADMIN', 'CEO'];
      } else if (targetTeamName === 'FINANCE') {
        allowedRoles = ['FINANCE_MANAGER', 'HR', 'SUPER_ADMIN', 'CEO'];
      }
    } else if (
      targetRole === 'IT_MANAGER' ||
      targetRole === 'SALES_MANAGER' ||
      targetRole === 'FINANCE_MANAGER'
    ) {
      allowedRoles = ['HR', 'SUPER_ADMIN', 'CEO'];
    } else if (targetRole === 'HR') {
      allowedRoles = ['SUPER_ADMIN', 'CEO'];
    } else if (targetRole === 'SUPER_ADMIN') {
      allowedRoles = ['CEO'];
    }

    if (!allowedRoles.length) {
      return false;
    }

    if (!allowedRoles.includes(actorRole)) {
      return false;
    }

    if (
      actorRole === 'IT_MANAGER' ||
      actorRole === 'SALES_MANAGER' ||
      actorRole === 'FINANCE_MANAGER'
    ) {
      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: actorEmployeeId },
        select: { id: true },
      });

      if (!Array.isArray(managedTeams) || !managedTeams.length) {
        return false;
      }

      if (targetEmployee.teamId === null || targetEmployee.teamId === undefined) {
        return false;
      }

      return managedTeams.some((team) => Number(team.id) === Number(targetEmployee.teamId));
    }

    if (targetRole === 'CEO') {
      return false;
    }

    return true;
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

    if (!(await this.hasActivePrincipal(user))) {
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
      normalizedRole === 'HR'
    ) {
      return true;
    }

    if (normalizedRole === 'EMPLOYEE') {
      return Number(user.employeeId) === targetId;
    }

    if (
      normalizedRole === 'IT_MANAGER' ||
      normalizedRole === 'SALES_MANAGER' ||
      normalizedRole === 'FINANCE_MANAGER'
    ) {
      const managerEmployeeId = Number(user.employeeId);
      if (!managerEmployeeId) {
        return false;
      }

      if (managerEmployeeId === targetId) {
        return true;
      }

      const targetEmployee = await this.getEmployeeTeamContext(targetId);
      if (!targetEmployee || targetEmployee.teamId === null || targetEmployee.teamId === undefined) {
        return false;
      }

      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: managerEmployeeId },
        select: { id: true },
      });

      if (!Array.isArray(managedTeams) || !managedTeams.length) {
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

    if (!(await this.hasActivePrincipal(user))) {
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
      normalizedRole === 'HR'
    ) {
      return true;
    }

    if (normalizedRole === 'EMPLOYEE') {
      return false;
    }

    if (
      normalizedRole === 'IT_MANAGER' ||
      normalizedRole === 'SALES_MANAGER' ||
      normalizedRole === 'FINANCE_MANAGER'
    ) {
      const managerEmployeeId = Number(user.employeeId);
      if (!managerEmployeeId) {
        return false;
      }

      const managedTeams = await this.prisma.team.findMany({
        where: { managerId: managerEmployeeId },
        select: { id: true },
      });

      if (!Array.isArray(managedTeams) || !managedTeams.length) {
        return false;
      }

      return managedTeams.some((team) => Number(team.id) === targetId);
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

    if (!(await this.hasActivePrincipal(user))) {
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
