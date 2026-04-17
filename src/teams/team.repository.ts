import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TeamRepository {

  constructor(private prisma: PrismaService) {}

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

  addMembers(teamId: number, employeeIds: number[]) {
    const ids = employeeIds.map((id) => Number(id)).filter((id) => Number.isInteger(id));
    if (!ids.length) {
      return { count: 0 };
    }

    return this.prisma.employee.updateMany({
      where: {
        id: { in: ids },
        teamId: null,
      },
      data: { teamId }
    });
  }

  removeMembers(teamId: number, employeeIds: number[]) {
    const ids = employeeIds.map((id) => Number(id)).filter((id) => Number.isInteger(id));
    if (!ids.length) {
      return { count: 0 };
    }

    return this.prisma.employee.updateMany({
      where: {
        id: { in: ids },
        teamId,
      },
      data: { teamId: null }
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