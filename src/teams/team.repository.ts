import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TeamRepository {

  constructor(private prisma: PrismaService) {}

  private normalizeEmployeeIds(employeeIds: number[]) {
    const ids = Array.isArray(employeeIds) ? employeeIds.map((id) => Number(id)) : [];

    if (ids.some((id) => !Number.isFinite(id) || !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException('employeeIds must contain only positive integer values');
    }

    return ids;
  }

  create(data: any) {
    return this.prisma.team.create({
      data,
      include: {
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        members: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });
  }

  async createWithMembers(data: any, employeeIds: number[]) {
    const ids = this.normalizeEmployeeIds(employeeIds);

    return this.prisma.$transaction(async (tx) => {
      if (ids.length) {
        const eligibleEmployees = await tx.employee.findMany({
          where: {
            id: { in: ids },
            teamId: null,
          },
          select: { id: true },
        });

        if (eligibleEmployees.length !== ids.length) {
          throw new BadRequestException(
            'One or more employees are already assigned to another team or invalid',
          );
        }
      }

      const team = await tx.team.create({
        data,
        include: {
          manager: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          members: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (ids.length) {
        const result = await tx.employee.updateMany({
          where: {
            id: { in: ids },
            teamId: null,
          },
          data: { teamId: team.id },
        });

        if (result.count !== ids.length) {
          throw new BadRequestException(
            'One or more employees are already assigned to another team or invalid',
          );
        }
      }

      return team;
    });
  }

  findAll() {
    return this.prisma.team.findMany({
      include: {
        manager: true,
        members: true
      }
    });
  }

  findById(id: number) {
    return this.prisma.team.findUnique({
      where: { id },
      include: {
        manager: true,
        members: true
      }
    });
  }

  findByManager(managerId: number) {
    return this.prisma.team.findMany({
      where: { managerId },
      include: {
        manager: true,
        members: true
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addMembers(teamId: number, employeeIds: number[]) {
    const ids = this.normalizeEmployeeIds(employeeIds);
    if (!ids.length) {
      return { count: 0 };
    }

    return this.prisma.$transaction(async (tx) => {
      const eligibleEmployees = await tx.employee.findMany({
        where: {
          id: { in: ids },
          teamId: null,
        },
        select: { id: true },
      });

      if (eligibleEmployees.length !== ids.length) {
        throw new BadRequestException(
          'One or more employees are already assigned to another team or invalid',
        );
      }

      const result = await tx.employee.updateMany({
        where: {
          id: { in: ids },
          teamId: null,
        },
        data: { teamId },
      });

      if (result.count !== ids.length) {
        throw new BadRequestException(
          'One or more employees are already assigned to another team or invalid',
        );
      }

      return result;
    });
  }

  async removeMembers(teamId: number, employeeIds: number[]) {
    const ids = this.normalizeEmployeeIds(employeeIds);
    if (!ids.length) {
      return { count: 0 };
    }

    return this.prisma.$transaction(async (tx) => {
      const members = await tx.employee.findMany({
        where: {
          id: { in: ids },
          teamId,
        },
        select: { id: true },
      });

      if (members.length !== ids.length) {
        throw new BadRequestException(
          'One or more employees are not members of this team or invalid',
        );
      }

      const result = await tx.employee.updateMany({
        where: {
          id: { in: ids },
          teamId,
        },
        data: { teamId: null },
      });

      if (result.count !== ids.length) {
        throw new BadRequestException(
          'One or more employees are not members of this team or invalid',
        );
      }

      return result;
    });
  }

  removeMember(teamId: number, employeeId: number) {
    return this.prisma.employee.updateMany({
      where: {
        id: employeeId,
        teamId,
      },
      data: { teamId: null }
    });
  }

  async deleteTeam(teamId: number) {
    // First, remove all members from the team
    await this.prisma.employee.updateMany({
      where: { teamId },
      data: { teamId: null }
    });

    // Then delete the team
    return this.prisma.team.delete({
      where: { id: teamId }
    });
  }

  findManager(empCode: string) {
    return this.prisma.employee.findUnique({
      where: { empCode },
      include: { user: true }
    });
  }
}