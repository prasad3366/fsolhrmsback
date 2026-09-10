import {
  Controller,
  Post,
  Body,
  Req,
  Param,
  UseGuards,
  Get,
  Patch,
  BadRequestException,
  ArgumentMetadata,
  ParseIntPipe,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { HelpdeskService } from './helpdesk.service';
import { CreateHelpdeskDto } from './dto/create-helpdesk.dto';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';

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

@Controller('helpdesk/tickets')
@UseGuards(JwtAuthGuard)
export class HelpdeskController {
  private readonly authorizationService: AuthorizationService;

  constructor(
    private readonly service: HelpdeskService,
    private readonly prisma: PrismaService,
  ) {
    this.authorizationService = new AuthorizationService(this.prisma);
  }

  private requireAuthenticatedUser(req: any) {
    const user = req?.user;

    if (!user || !user.role) {
      throw new UnauthorizedException('Authentication required');
    }

    return user;
  }

  // Create Ticket
  @Post()
  createTicket(@Req() req, @Body() dto: CreateHelpdeskDto) {
    const user = this.requireAuthenticatedUser(req);
    const userId = Number(user.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new UnauthorizedException('User profile required');
    }

    return this.service.create(userId, dto);
  }

  // Get My Tickets
  @Get('my-tickets')
  async getMyTickets(@Req() req) {
    const user = this.requireAuthenticatedUser(req);
    const userId = Number(user.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new UnauthorizedException('User profile required');
    }

    const employeeId = Number(user.employeeId ?? 0);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new UnauthorizedException('Employee profile required');
    }

    const hasAccess = await this.authorizationService.canAccessEmployee(
      user,
      employeeId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('Access denied');
    }

    return this.service.getMine(userId);
  }

  // Get All Tickets (HR / SUPER_ADMIN)
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  @Get()
  getAllTickets(@Req() req) {
    this.requireAuthenticatedUser(req);
    return this.service.getAll();
  }

  // Approve Ticket (HR / SUPER_ADMIN)
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  @Patch(':id/approve')
  approveTicket(@Req() req, @Param('id', PositiveIntPipe) id: number) {
    const user = this.requireAuthenticatedUser(req);
    return this.service.approve(id, user);
  }

  // Resolve Ticket (HR / SUPER_ADMIN)
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  @Patch(':id/resolve')
  resolveTicket(@Req() req, @Param('id', PositiveIntPipe) id: number) {
    const user = this.requireAuthenticatedUser(req);
    return this.service.resolve(id, user);
  }
}