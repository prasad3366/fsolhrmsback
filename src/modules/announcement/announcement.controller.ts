import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorators';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AnnouncementService } from './announcement.service';

const MANAGEMENT_ROLES = [
  'SUPER_ADMIN', 'Super_admin', 'CEO', 'HR', 'HR_MANAGER',
  'MANAGER', 'IT_MANAGER', 'SALES_MANAGER',
];

@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Post()
  @Roles(...MANAGEMENT_ROLES)
  createAnnouncement(@Body() dto: CreateAnnouncementDto, @Req() req: any) {
    return this.announcementService.createAnnouncement(dto, req.user);
  }

  @Get()
  getAnnouncements(@Req() req: any) {
    return this.announcementService.getAnnouncements(req.user);
  }

  @Get('feed')
  getFeed(@Req() req: any) {
    return this.announcementService.getAnnouncements(req.user);
  }

  @Get(':id')
  getAnnouncementById(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.announcementService.getAnnouncementById(id, req.user);
  }

  @Patch(':id')
  @Roles(...MANAGEMENT_ROLES)
  updateAnnouncement(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAnnouncementDto,
    @Req() req: any,
  ) {
    return this.announcementService.updateAnnouncement(id, dto, req.user);
  }

  @Delete(':id')
  @Roles(...MANAGEMENT_ROLES)
  deleteAnnouncement(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.announcementService.deleteAnnouncement(id, req.user);
  }

  @Post(':id/read')
  markAsRead(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.announcementService.markAsRead(id, req.user.employeeId, req.user);
  }

  @Delete(':id/read')
  markAsUnread(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.announcementService.markAsUnread(id, req.user.employeeId, req.user);
  }
}
