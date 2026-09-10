import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  Put,
  Patch,
  UnauthorizedException,
  BadRequestException,
  ArgumentMetadata,
  ParseIntPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { AssignAssetDto } from './dto/assign-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import {
  AuthorizationService,
  type AuthorizationUser,
} from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';

type AuthenticatedRequest = Request & {
  user?: AuthorizationUser;
};

export class PositiveIntPipe extends ParseIntPipe {
  async transform(value: string, metadata: ArgumentMetadata) {
    const parsedValue = await super.transform(value, metadata);
    if (parsedValue <= 0) {
      throw new BadRequestException(
        'Validation failed (positive integer is expected)',
      );
    }
    return parsedValue;
  }
}

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  private readonly authorizationService: AuthorizationService;

  constructor(
    private readonly assetsService: AssetsService,
    private readonly prisma: PrismaService,
  ) {
    this.authorizationService = new AuthorizationService(this.prisma);
  }

  private requireAuthenticatedUser(
    req: AuthenticatedRequest,
  ): AuthorizationUser {
    const user = req?.user;

    if (!user || !user.role) {
      throw new UnauthorizedException('Authentication required');
    }

    return user;
  }

  private hasOrgWideAssetAccess(user: AuthorizationUser): boolean {
    return this.authorizationService.canAccessOrganizationWide(user, 'assets');
  }

  // 🔥 HR creates & assigns asset
  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateAssetDto) {
    this.requireAuthenticatedUser(req);
    return this.assetsService.create(dto);
  }

  @Post('assign')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  assign(@Req() req: AuthenticatedRequest, @Body() dto: AssignAssetDto) {
    this.requireAuthenticatedUser(req);
    return this.assetsService.assignAsset(dto);
  }

  // 🔥 HR/Admin view all
  @Get()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  findAll(@Req() req: AuthenticatedRequest) {
    this.requireAuthenticatedUser(req);
    return this.assetsService.findAll();
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', PositiveIntPipe) id: number,
    @Body() dto: UpdateAssetDto,
  ) {
    this.requireAuthenticatedUser(req);
    return this.assetsService.update(id, dto);
  }

  @Get(':id/history')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  history(
    @Req() req: AuthenticatedRequest,
    @Param('id', PositiveIntPipe) id: number,
  ) {
    this.requireAuthenticatedUser(req);
    return this.assetsService.findAssignmentHistory(id);
  }

  // 🔥 Employee view own assets
  @Get('my-assets')
  async getMyAssetsFromToken(@Req() req: AuthenticatedRequest) {
    const user = this.requireAuthenticatedUser(req);
    if (!Number.isInteger(user.id) || user.id <= 0) {
      throw new BadRequestException('Authenticated user ID required');
    }

    return this.assetsService.findMyAssets(user.id);
  }

  // 🔥 HR/Admin return asset
  @Put('return/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  returnAsset(
    @Req() req: AuthenticatedRequest,
    @Param('id', PositiveIntPipe) id: number,
  ) {
    this.requireAuthenticatedUser(req);
    return this.assetsService.returnAsset(id);
  }
}
