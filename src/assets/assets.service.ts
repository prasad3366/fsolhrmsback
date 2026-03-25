import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDto } from './dto/create-asset.dto';

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAssetDto) {
    return this.prisma.asset.create({
      data: {
        name: dto.name,
        description: dto.description,
        assignedTo: dto.assignedTo,
        assignedAt: dto.assignedTo ? new Date() : null,
      },
    });
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

  async returnAsset(assetId: number) {
    return this.prisma.asset.update({
      where: { id: assetId },
      data: {
        status: 'RETURNED',
        returnedAt: new Date(),
        assignedTo: null,
        assignedAt: null,
      },
      include: {
        user: {
          include: {
            employee: true,
          },
        },
      },
    });
  }
}