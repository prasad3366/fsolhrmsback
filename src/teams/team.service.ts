import { Injectable, BadRequestException } from '@nestjs/common';
import { TeamRepository } from './team.repository';

@Injectable()
export class TeamService {

  constructor(private repo: TeamRepository) {}

  async createTeam(dto: any) {

    const manager = await this.repo.findManager(dto.managerId);

    if (!manager || manager.user.role !== 'MANAGER') {
      throw new BadRequestException('Selected employee is not a manager');
    }

    const employeeIds = this.normalizeEmployeeIds(dto.employeeIds);
    console.log('createTeam called with employeeIds:', dto.employeeIds, 'normalized:', employeeIds);

    const team = await this.repo.create({
      name: dto.name,
      managerId: manager.id
    });

    if (employeeIds.length) {
      await this.repo.addMembers(team.id, employeeIds);
    }

    return this.repo.findById(team.id);
  }

  async getAllTeams() {

    const teams = await this.repo.findAll();

    return teams.map(team => ({
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

  async addMembers(teamId: number, employeeIds: number[]) {
    const ids = this.normalizeEmployeeIds(employeeIds);
    console.log('addMembers called with teamId:', teamId, 'employeeIds:', employeeIds, 'normalized ids:', ids);
    if (!ids.length) {
      throw new BadRequestException('employeeIds must contain valid numeric ids');
    }

    const result = await this.repo.addMembers(teamId, ids);
    console.log('addMembers result:', result, 'expected count:', ids.length);
    if (result.count !== ids.length) {
      throw new BadRequestException('One or more employees are already assigned to another team or invalid');
    }

    return this.repo.findById(teamId);
  }

  async removeMembers(teamId: number, employeeIds: number[]) {
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

  async removeMember(teamId: number, employeeId: number) {
    const result = await this.repo.removeMember(teamId, employeeId);
    if (result.count !== 1) {
      throw new BadRequestException('Employee is not a member of this team or invalid');
    }

    return this.repo.findById(teamId);
  }

  async deleteTeam(teamId: number) {
    const team = await this.repo.findById(teamId);
    if (!team) {
      throw new BadRequestException('Team not found');
    }

    await this.repo.deleteTeam(teamId);
    return { message: 'Team deleted successfully' };
  }

  private normalizeEmployeeIds(employeeIds?: number[]) {
    return (employeeIds ?? [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id));
  }

  async getMyTeam(managerId: number) {

    const teams = await this.repo.findByManager(managerId);

    return teams.map(team => ({
      id: team.id,
      name: team.name,
      manager: {
        id: team.manager.id,
        firstName: team.manager.firstName,
        lastName: team.manager.lastName,
      },
      managerName: `${team.manager.firstName} ${team.manager.lastName}`,
      members: team.members,
      membersCount: team.members.length,
      createdAt: team.createdAt,
      created: team.createdAt,
    }));
  }
}