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

@Controller('helpdesk')
@UseGuards(JwtAuthGuard)
export class HelpdeskController {
  constructor(private readonly service: HelpdeskService) {}

  @Post()
  @Post('submit')
  submitIssue(@Req() req, @Body() dto: CreateHelpdeskDto) {
    return this.service.create(req.user.id, dto);
  }

  @Get()
  @Get('my')
  getMyIssues(@Req() req) {
    return this.service.getMine(req.user.id);
  }

  @UseGuards(RolesGuard)
  @Roles('HR', 'ADMIN')
  @Get('all')
  getAllIssues() {
    return this.service.getAll();
  }

  @UseGuards(RolesGuard)
  @Roles('HR', 'ADMIN')
  @Patch(':id/approve')
  approveIssue(@Param('id') id: string) {
    return this.service.approve(Number(id));
  }

  @UseGuards(RolesGuard)
  @Roles('HR', 'ADMIN')
  @Patch(':id/resolve')
  resolveIssue(@Param('id') id: string) {
    return this.service.resolve(Number(id));
  }
}
