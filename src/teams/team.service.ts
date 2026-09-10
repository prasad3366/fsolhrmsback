import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { TeamRepository } from './team.repository';

@Injectable()
export class TeamService {
  private readonly authorizationService: AuthorizationService;

  constructor(
    private repo: TeamRepository,
    private prisma: PrismaService,
  ) {
    this.authorizationService = new AuthorizationService(this.prisma);
  }

  private normalizeRole(role?: string) {
    return String(role ?? '').toUpperCase();
  }

  private async assertTeamAccess(user: any, teamId: number) {
    if (!user) {
      throw new UnauthorizedException('Authenticated user required');
    }

    if (this.authorizationService.canAccessOrganizationWide(user, 'team')) {
      return;
    }

    const teamAllowed = await this.authorizationService.canAccessTeam(user, teamId);
    if (!teamAllowed) {
      throw new ForbiddenException('You do not have permission to access this team');
    }
  }

  private async assertTeamAdminAccess(user: any, teamId: number) {
    if (!user) {
      throw new UnauthorizedException('Authenticated user required');
    }

    if (this.authorizationService.canAccessOrganizationWide(user, 'team')) {
      const team = await this.repo.findById(teamId);
      if (!team) {
        throw new BadRequestException('Team not found');
      }
      return;
    }

    const teamAllowed = await this.authorizationService.canAccessTeam(user, teamId);
    if (!teamAllowed) {
      throw new ForbiddenException('You may only manage your own assigned team');
    }
  }

  async createTeam(dto: any, user: any) {
    if (!user) {
      throw new UnauthorizedException('Authenticated user required');
    }

    const role = this.normalizeRole(user.role);
    const permittedRoles = ['SUPER_ADMIN', 'CEO'];
    if (!permittedRoles.includes(role)) {
      throw new ForbiddenException('Only SUPER_ADMIN and CEO may create teams');
    }

    if (typeof dto?.name !== 'string' || dto.name.trim() === '') {
      throw new BadRequestException('Team name must be a non-empty string');
    }

    if (typeof dto?.managerId !== 'string' || dto.managerId.trim() === '') {
      throw new BadRequestException('managerId must be a non-empty string');
    }

    const manager = await this.repo.findManager(dto.managerId);
    const validManagerRoles = ['IT_MANAGER', 'SALES_MANAGER'];
    const managerRole = this.normalizeRole(manager?.user?.role);

    if (!manager || !validManagerRoles.includes(managerRole)) {
      throw new BadRequestException('Selected employee is not a valid team manager');
    }

    const employeeIds = this.normalizeEmployeeIds(dto.employeeIds);

    const team = await this.repo.createWithMembers(
      {
        name: dto.name,
        managerId: manager.id,
      },
      employeeIds,
    );

    return this.repo.findById(team.id);
  }

  async getAllTeams(user: any) {
    if (!user) {
      throw new UnauthorizedException('Authenticated user required');
    }

    const role = this.normalizeRole(user.role);

    if (this.authorizationService.canAccessOrganizationWide(user, 'team')) {
      return this.mapTeams(await this.repo.findAll());
    }

    if (role === 'IT_MANAGER' || role === 'SALES_MANAGER') {
      const teams = await this.repo.findByManager(Number(user.employeeId));
      return this.mapTeams(teams);
    }

    throw new ForbiddenException('Employee access to team listing is not allowed');
  }

  async addMembers(teamId: number, employeeIds: number[], user: any) {
    await this.assertTeamAdminAccess(user, teamId);

    const ids = this.normalizeEmployeeIds(employeeIds);
    if (!ids.length) {
      throw new BadRequestException('employeeIds must contain valid numeric ids');
    }

    const result = await this.repo.addMembers(teamId, ids);
    if (result.count !== ids.length) {
      throw new BadRequestException('One or more employees are already assigned to another team or invalid');
    }

    return this.repo.findById(teamId);
  }

  async removeMembers(teamId: number, employeeIds: number[], user: any) {
    await this.assertTeamAdminAccess(user, teamId);

    const ids = this.normalizeEmployeeIds(employeeIds);
    if (!ids.length) {
      throw new BadRequestException('employeeIds must contain valid numeric ids');
    }

    const result = await this.repo.removeMembers(teamId, ids);
    if (result.count !== ids.length) {
      throw new BadRequestException('One or more employees are not members of this team or invalid');
    }

    return this.repo.findById(teamId);
  }

  async removeMember(teamId: number, employeeId: number, user: any) {
    await this.assertTeamAdminAccess(user, teamId);

    const result = await this.repo.removeMember(teamId, employeeId);
    if (result.count !== 1) {
      throw new BadRequestException('Employee is not a member of this team or invalid');
    }

    return this.repo.findById(teamId);
  }

  async deleteTeam(teamId: number, user: any) {
    if (!user) {
      throw new UnauthorizedException('Authenticated user required');
    }

    const role = this.normalizeRole(user.role);
    if (role !== 'SUPER_ADMIN' && role !== 'CEO') {
      throw new ForbiddenException('Only SUPER_ADMIN and CEO may delete teams');
    }

    const team = await this.repo.findById(teamId);
    if (!team) {
      throw new BadRequestException('Team not found');
    }

    await this.repo.deleteTeam(teamId);
    return { message: 'Team deleted successfully' };
  }

  private mapTeams(teams: any[]) {
    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      manager: {
        id: team.manager.id,
        firstName: team.manager.firstName,
        lastName: team.manager.lastName,
      },
      managerName: `${team.manager.firstName} ${team.manager.lastName}`,
      membersCount: team.members.length,
      members: team.members,
      createdAt: team.createdAt,
      created: team.createdAt,
    }));
  }

  private normalizeEmployeeIds(employeeIds?: number[]) {
    const ids = Array.isArray(employeeIds) ? employeeIds : [];

    if (!ids.length) {
      return [];
    }

    const normalized = ids.map((id) => Number(id));
    const hasInvalidId = normalized.some(
      (id) => !Number.isFinite(id) || !Number.isInteger(id) || id <= 0,
    );

    if (hasInvalidId) {
      throw new BadRequestException('employeeIds must contain only positive integer values');
    }

    return normalized;
  }

  async getMyTeam(employeeId: number, user: any) {
    if (!user) {
      throw new UnauthorizedException('Authenticated user required');
    }

    const role = this.normalizeRole(user.role);
    if (role === 'IT_MANAGER' || role === 'SALES_MANAGER') {
      const teams = await this.repo.findByManager(employeeId);
      return this.mapTeams(teams);
    }

    if (role === 'EMPLOYEE') {
      const employee = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        include: {
          team: {
            include: {
              manager: true,
              members: true,
            },
          },
        },
      });

      if (!employee?.team) {
        return [];
      }

      return this.mapTeams([employee.team]);
    }

    const teams = await this.repo.findByManager(employeeId);
    return this.mapTeams(teams);
  }
}