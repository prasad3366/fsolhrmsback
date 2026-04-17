import { Controller, Post, Body, Get, Param, Req, UseGuards, UnauthorizedException, Delete } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TeamService } from './team.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { AddMembersDto } from './dto/add-memebers.dto';

@UseGuards(JwtAuthGuard)
@Controller('teams')
export class TeamController {

  constructor(private teamService: TeamService) {}

  @Post()
  createTeam(@Body() dto: CreateTeamDto) {
    return this.teamService.createTeam(dto);
  }

  @Get()
  getAllTeams() {
    return this.teamService.getAllTeams();
  }

  @Post(':id/members')
  addMembers(@Param('id') id: string, @Body() dto: AddMembersDto) {
    return this.teamService.addMembers(+id, dto.employeeIds);
  }

  @Delete(':id/members')
  removeMembers(@Param('id') id: string, @Body() dto: AddMembersDto) {
    return this.teamService.removeMembers(+id, dto.employeeIds);
  }

  @Delete(':id/members/:employeeId')
  removeMember(@Param('id') id: string, @Param('employeeId') employeeId: string) {
    return this.teamService.removeMember(+id, +employeeId);
  }

  @Delete(':id')
  deleteTeam(@Param('id') id: string) {
    return this.teamService.deleteTeam(+id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-team')
  getMyTeam(@Req() req: any) {
    const employeeId = req.user?.employeeId;
    if (!employeeId) {
      throw new UnauthorizedException('Authenticated user required');
    }
    return this.teamService.getMyTeam(employeeId);
  }
}