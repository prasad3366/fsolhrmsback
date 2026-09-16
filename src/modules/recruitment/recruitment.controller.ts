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
import { RecruitmentService } from './recruitment.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';

@Controller('recruitment')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecruitmentController {
  constructor(private readonly recruitmentService: RecruitmentService) {}

  @Post('jobs')
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  createJob(@Body() dto: CreateJobDto, @Req() req: any) {
    return this.recruitmentService.createJob(dto, req.user.id);
  }

  @Get('candidates')
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  findCandidates() {
    return this.recruitmentService.findCandidates();
  }

  @Get('jobs')
  @Roles(
    'SUPER_ADMIN',
    'CEO',
    'HR',
    'FINANCE_MANAGER',
    'IT_MANAGER',
    'SALES_MANAGER',
    'EMPLOYEE',
  )
  findJobs() {
    return this.recruitmentService.findJobs();
  }

  @Delete('jobs/:id')
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  deleteJob(@Param('id', ParseIntPipe) id: number) {
    return this.recruitmentService.deleteJob(id);
  }

  @Patch('jobs/:id')
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  updateJob(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateJobDto) {
    return this.recruitmentService.updateJob(id, dto);
  }

  @Delete('candidates/:id')
  @Roles('SUPER_ADMIN', 'CEO', 'HR')
  deleteCandidate(@Param('id', ParseIntPipe) id: number) {
    return this.recruitmentService.deleteCandidate(id);
  }
}
