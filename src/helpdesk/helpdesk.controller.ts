import {
  Controller,
  Post,
  Body,
  Req,
  Param,
  UseGuards,
  Get,
  Patch,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { HelpdeskService } from './helpdesk.service';
import { CreateHelpdeskDto } from './dto/create-helpdesk.dto';

@Controller('helpdesk/tickets')
@UseGuards(JwtAuthGuard)
export class HelpdeskController {
  constructor(private readonly service: HelpdeskService) {}

  // Create Ticket
  @Post()
  createTicket(@Req() req, @Body() dto: CreateHelpdeskDto) {
    return this.service.create(req.user.id, dto);
  }

  // Get My Tickets
  @Get('my-tickets')
  getMyTickets(@Req() req) {
    return this.service.getMine(req.user.id);
  }

  // Get All Tickets (HR/Admin)
  @UseGuards(RolesGuard)
  @Roles('HR', 'ADMIN')
  @Get()
  getAllTickets() {
    return this.service.getAll();
  }

  // Approve Ticket (HR/Admin)
  @UseGuards(RolesGuard)
  @Roles('HR', 'ADMIN')
  @Patch(':id/approve')
  approveTicket(@Param('id') id: string) {
    return this.service.approve(Number(id));
  }

  // Resolve Ticket (HR/Admin)
  @UseGuards(RolesGuard)
  @Roles('HR', 'ADMIN')
  @Patch(':id/resolve')
  resolveTicket(@Param('id') id: string) {
    return this.service.resolve(Number(id));
  }
}