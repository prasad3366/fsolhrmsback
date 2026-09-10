import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { AssignAssetDto } from './dto/assign-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import {
  AuthorizationService,
  AuthorizationUser,
} from '../common/authorization/authorization.service';

@Injectable()
export class AssetsService {
  constructor(
    private prisma: PrismaService,
    private authorizationService: AuthorizationService,
  ) {}

  private isSerializationConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2034'
    );
  }

  async create(dto: CreateAssetDto) {
    if (typeof dto?.name !== 'string' || dto.name.trim() === '') {
      throw new BadRequestException('Asset name must be a non-empty string');
    }

    if (dto.assignedTo !== undefined) {
      if (!Number.isInteger(dto.assignedTo) || dto.assignedTo <= 0) {
        throw new BadRequestException('assignedTo must be a positive integer User ID');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: dto.assignedTo },
        select: { id: true },
      });
      if (!user) {
        throw new BadRequestException('Assigned user not found');
      }
    }

    return this.prisma.asset.create({
      data: {
        name: dto.name,
        description: dto.description,
        assignedTo: dto.assignedTo,
        assignedAt: dto.assignedTo ? new Date() : null,
        status: dto.assignedTo === undefined ? 'AVAILABLE' : 'ASSIGNED',
      },
    });
  }

  async assignAsset(dto: AssignAssetDto) {
    if (!Number.isInteger(dto?.assetId) || dto.assetId <= 0) {
      throw new BadRequestException('assetId must be a positive integer');
    }
    if (!Number.isInteger(dto?.employeeId) || dto.employeeId <= 0) {
      throw new BadRequestException('employeeId must be a positive integer');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const employee = await tx.employee.findUnique({
          where: { id: dto.employeeId },
          select: { id: true, userId: true },
        });
        if (!employee) {
          throw new NotFoundException('Employee not found');
        }

        const asset = await tx.asset.findUnique({
          where: { id: dto.assetId },
          select: { id: true, status: true, assignedTo: true },
        });
        if (!asset) {
          throw new NotFoundException('Asset not found');
        }
        if (asset.status === 'RETURNED') {
          throw new BadRequestException('Returned assets cannot be assigned');
        }
        if (asset.status !== 'AVAILABLE' && asset.status !== 'ASSIGNED') {
          throw new BadRequestException('Asset is not in an assignable state');
        }
        if (asset.status === 'AVAILABLE' && asset.assignedTo !== null) {
          throw new BadRequestException('Asset is not in an assignable state');
        }
        if (asset.status === 'ASSIGNED' && asset.assignedTo === null) {
          throw new BadRequestException('Asset is not in an assignable state');
        }
        if (asset.assignedTo === employee.userId) {
          throw new BadRequestException('Asset is already assigned to this employee');
        }

        const now = new Date();
        const transition = await tx.asset.updateMany({
          where: asset.status === 'AVAILABLE'
            ? { id: asset.id, status: 'AVAILABLE', assignedTo: null }
            : { id: asset.id, status: 'ASSIGNED', assignedTo: asset.assignedTo },
          data: {
            status: 'ASSIGNED',
            assignedTo: employee.userId,
            assignedAt: now,
            returnedAt: null,
          },
        });

        if (transition.count !== 1) {
          throw new BadRequestException('Asset assignment changed; retry the request');
        }

        if (asset.status === 'ASSIGNED') {
          await tx.assetAssignment.updateMany({
            where: {
              assetId: asset.id,
              unassignedAt: null,
            },
            data: { unassignedAt: now },
          });
        }

        await tx.assetAssignment.create({
          data: {
            assetId: asset.id,
            assignedTo: employee.userId,
            assignedAt: now,
          },
        });

        return tx.asset.findUnique({
          where: { id: asset.id },
          include: {
            user: {
              include: {
                employee: true,
              },
            },
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException('Asset assignment conflicts with another request');
      }
      throw error;
    }
  }

  async findAll() {
    return this.prisma.asset.findMany({
      include: {
        user: {
          include: {
            employee: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async update(assetId: number, dto: UpdateAssetDto) {
    if (!Number.isInteger(assetId) || assetId <= 0) {
      throw new BadRequestException('assetId must be a positive integer');
    }
    if (dto.name !== undefined && (typeof dto.name !== 'string' || dto.name.trim() === '')) {
      throw new BadRequestException('Asset name must be a non-empty string');
    }

    try {
      return await this.prisma.asset.update({
        where: { id: assetId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
        include: { user: { include: { employee: true } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Asset not found');
      }
      throw error;
    }
  }

  async findAssignmentHistory(assetId: number) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true },
    });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    return this.prisma.assetAssignment.findMany({
      where: { assetId },
      include: { user: { include: { employee: true } } },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async findMyAssets(userId: number) {
    return this.prisma.asset.findMany({
      where: {
        assignedTo: userId,
      },
      include: {
        user: {
          include: {
            employee: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findEmployee360Assets(
    user: AuthorizationUser,
    employeeId: number,
  ) {
    const normalizedRole = String(user.role ?? '').toUpperCase();
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });

    if (!employee) {
      return [];
    }

    const isAdministrator = ['SUPER_ADMIN', 'CEO', 'HR'].includes(normalizedRole);
    if (!isAdministrator && employee.userId !== user.id) {
      throw new ForbiddenException('Access denied for employee assets');
    }

    return this.prisma.asset.findMany({
      where: { assignedTo: employee.userId },
      select: {
        id: true,
        name: true,
        description: true,
        assignedAt: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async returnAsset(assetId: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const transition = await tx.asset.updateMany({
          where: {
            id: assetId,
            status: 'ASSIGNED',
            assignedTo: { not: null },
          },
          data: {
            status: 'AVAILABLE',
            returnedAt: now,
            assignedTo: null,
            assignedAt: null,
          },
        });

        if (transition.count !== 1) {
          const asset = await tx.asset.findUnique({
            where: { id: assetId },
            select: { id: true },
          });

          if (!asset) {
            throw new NotFoundException('Asset not found');
          }

          throw new BadRequestException('Asset is not currently assigned');
        }

        await tx.assetAssignment.updateMany({
          where: {
            assetId,
            unassignedAt: null,
          },
          data: { unassignedAt: now },
        });

        return tx.asset.findUnique({
          where: { id: assetId },
          include: {
            user: {
              include: {
                employee: true,
              },
            },
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException('Asset return conflicts with another request');
      }
      throw error;
    }
  }
}