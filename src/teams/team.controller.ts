import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Req,
  UseGuards,
  UnauthorizedException,
  Delete,
  ArgumentMetadata,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { TeamService } from './team.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { AddMembersDto } from './dto/add-memebers.dto';

export class PositiveIntPipe extends ParseIntPipe {
  async transform(value: string, metadata: ArgumentMetadata) {
    const parsedValue = await super.transform(value, metadata);
    if (parsedValue <= 0) {
      throw new BadRequestException('Validation failed (positive integer is expected)');
    }
    return parsedValue;
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('teams')
export class TeamController {
  constructor(private teamService: TeamService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  createTeam(@Req() req: any, @Body() dto: CreateTeamDto) {
    return this.teamService.createTeam(dto, req.user);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER')
  getAllTeams(@Req() req: any) {
    return this.teamService.getAllTeams(req.user);
  }

  @Post(':id/members')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER')
  addMembers(@Req() req: any, @Param('id', PositiveIntPipe) id: number, @Body() dto: AddMembersDto) {
    return this.teamService.addMembers(id, dto.employeeIds, req.user);
  }

  @Delete(':id/members')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER')
  removeMembers(@Req() req: any, @Param('id', PositiveIntPipe) id: number, @Body() dto: AddMembersDto) {
    return this.teamService.removeMembers(id, dto.employeeIds, req.user);
  }

  @Delete(':id/members/:employeeId')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER')
  removeMember(
    @Req() req: any,
    @Param('id', PositiveIntPipe) id: number,
    @Param('employeeId', PositiveIntPipe) employeeId: number,
  ) {
    return this.teamService.removeMember(id, employeeId, req.user);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  deleteTeam(@Req() req: any, @Param('id', PositiveIntPipe) id: number) {
    return this.teamService.deleteTeam(id, req.user);
  }

  @Get('my-team')
  @Roles('SUPER_ADMIN', 'CEO', 'HR', 'IT_MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER', 'EMPLOYEE')
  getMyTeam(@Req() req: any) {
    const employeeId = req.user?.employeeId;
    if (!employeeId) {
      throw new UnauthorizedException('Authenticated user required');
    }
    return this.teamService.getMyTeam(Number(employeeId), req.user);
  }
}