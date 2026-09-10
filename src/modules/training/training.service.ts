import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, TrainingStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTrainingDto } from './dto/create-training.dto';
import { EnrollEmployeesDto } from './dto/enroll-employees.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { UpdateTrainingDto } from './dto/update-training.dto';

@Injectable()
export class TrainingService {
  constructor(private readonly prisma: PrismaService) {}

  createProgram(dto: CreateTrainingDto, userId: number) {
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('Training start date cannot be after end date');
    }

    return this.prisma.trainingProgram.create({
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
  }

  getPrograms(reqUser: { role?: string; employeeId?: number | null }) {
    const isEmployee = String(reqUser.role).toUpperCase() === 'EMPLOYEE';

    return this.prisma.trainingProgram.findMany({
      where: isEmployee
        ? { enrollments: { some: { employeeId: reqUser.employeeId ?? -1 } } }
        : undefined,
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

  enrollEmployees(dto: EnrollEmployeesDto) {
    return this.prisma.trainingEnrollment.createMany({
      data: dto.employeeIds.map((employeeId) => ({
        trainingProgramId: dto.trainingProgramId,
        employeeId,
      })),
      skipDuplicates: true,
    });
  }

  async updateEnrollmentStatus(
    employeeId: number | null | undefined,
    enrollmentId: number,
    dto: UpdateEnrollmentDto,
  ) {
    const enrollment = await this.prisma.trainingEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment || (employeeId && enrollment.employeeId !== employeeId)) {
      throw new NotFoundException('Training enrollment not found');
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
