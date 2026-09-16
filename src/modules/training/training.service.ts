import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, Prisma } from '@prisma/client';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTrainingDto } from './dto/create-training.dto';
import { EnrollEmployeesDto } from './dto/enroll-employees.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { UpdateTrainingDto } from './dto/update-training.dto';

@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  private async canAccessTrainingEnrollment(
    user: { role?: string; employeeId?: number | null } | undefined,
    employeeId: number | null | undefined,
  ): Promise<boolean> {
    if (!user || !employeeId) {
      return false;
    }

    const role = String(user.role ?? '').toUpperCase();

    if (['SUPER_ADMIN', 'CEO', 'HR'].includes(role)) {
      return true;
    }

    if (role === 'EMPLOYEE') {
      return Number(user.employeeId) === Number(employeeId);
    }

    if (['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'].includes(role)) {
      return this.authorizationService.canAccessEmployee(user as any, employeeId);
    }

    return false;
  }

  private async getManagedTeamIdsForManager(
    user: { role?: string; employeeId?: number | null } | undefined,
  ): Promise<number[]> {
    if (!user) {
      return [];
    }

    const role = String(user.role ?? '').toUpperCase();
    if (!['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'].includes(role)) {
      return [];
    }

    const managerEmployeeId = Number(user.employeeId);
    if (!Number.isInteger(managerEmployeeId) || managerEmployeeId <= 0) {
      return [];
    }

    const teams = await this.prisma.team.findMany({
      where: { managerId: managerEmployeeId },
      select: { id: true },
    });

    return teams.map((team: { id: number }) => Number(team.id));
  }

  async createProgram(dto: CreateTrainingDto, userId: number) {
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('Training start date cannot be after end date');
    }

    return this.prisma.$transaction(async (transaction) => {
      const program = await transaction.trainingProgram.create({
        data: {
          title: dto.title,
          description: dto.description,
          trainer: dto.trainer,
          department: dto.department,
          startDate: dto.startDate,
          endDate: dto.endDate,
          createdById: userId,
        },
      });

      if (dto.employeeIds?.length) {
        await this.createEnrollments(transaction, {
          trainingProgramId: program.id,
          employeeIds: dto.employeeIds,
        });
      }

      return program;
    });
  }

  async getPrograms(reqUser: { role?: string; employeeId?: number | null }) {
    const role = String(reqUser.role ?? '').toUpperCase();

    if (role === 'EMPLOYEE') {
      return this.prisma.trainingProgram.findMany({
        where: { enrollments: { some: { employeeId: reqUser.employeeId ?? -1 } } },
        include: {
          enrollments: {
            include: {
              employee: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  designation: true,
                  user: {
                    select: {
                      email: true,
                    },
                  },
                },
              },
            },
          },
          _count: {
            select: {
              enrollments: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'].includes(role)) {
      const teamIds = await this.getManagedTeamIdsForManager(reqUser);
      if (!teamIds.length) {
        return [];
      }

      return this.prisma.trainingProgram.findMany({
        where: {
          enrollments: {
            some: {
              employee: {
                teamId: { in: teamIds },
              },
            },
          },
        },
        include: {
          enrollments: {
            include: {
              employee: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  designation: true,
                  user: {
                    select: {
                      email: true,
                    },
                  },
                },
              },
            },
          },
          _count: {
            select: {
              enrollments: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return this.prisma.trainingProgram.findMany({
      include: {
        enrollments: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                user: {
                  select: {
                    email: true,
                  },
                },
              },
            },
          },
        },
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  updateProgram(id: number, dto: UpdateTrainingDto) {
    if (dto.startDate && dto.endDate && dto.startDate > dto.endDate) {
      throw new BadRequestException('Training start date cannot be after end date');
    }

    return this.prisma.trainingProgram.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.trainer !== undefined && { trainer: dto.trainer }),
        ...(dto.department !== undefined && { department: dto.department }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  deleteProgram(id: number) {
    return this.prisma.trainingProgram.delete({ where: { id } });
  }

  private async createEnrollments(
    prisma: Prisma.TransactionClient | PrismaService,
    dto: EnrollEmployeesDto,
  ) {
    const employeeIds = [...new Set(dto.employeeIds)];
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true },
    });

    if (employees.length !== employeeIds.length) {
      throw new BadRequestException('One or more selected employees do not exist');
    }

    return prisma.trainingEnrollment.createMany({
      data: employeeIds.map((employeeId) => ({
        trainingProgramId: dto.trainingProgramId,
        employeeId,
      })),
      skipDuplicates: true,
    });
  }

  enrollEmployees(dto: EnrollEmployeesDto) {
    return this.createEnrollments(this.prisma, dto);
  }

  async updateEnrollmentStatus(
    user: { role?: string; employeeId?: number | null } | undefined,
    enrollmentId: number,
    dto: UpdateEnrollmentDto,
  ) {
    const enrollment = await this.prisma.trainingEnrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      throw new NotFoundException('Training enrollment not found');
    }

    const role = String(user?.role ?? '').toUpperCase();

    if (role === 'EMPLOYEE') {
      if (!user?.employeeId || Number(user.employeeId) !== enrollment.employeeId) {
        throw new NotFoundException('Training enrollment not found');
      }
    } else if (['IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER'].includes(role)) {
      const canAccess = await this.canAccessTrainingEnrollment(user, enrollment.employeeId);
      if (!canAccess) {
        throw new ForbiddenException('Training access denied');
      }
    } else if (!['SUPER_ADMIN', 'CEO', 'HR'].includes(role)) {
      throw new ForbiddenException('Training access denied');
    }

    return this.prisma.trainingEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: dto.status,
        feedback: dto.feedback,
        completedAt:
          dto.status === EnrollmentStatus.COMPLETED ? new Date() : null,
      },
    });
  }
}
