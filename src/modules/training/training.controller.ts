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
import { CreateTrainingDto } from './dto/create-training.dto';
import { EnrollEmployeesDto } from './dto/enroll-employees.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { UpdateTrainingDto } from './dto/update-training.dto';
import { TrainingService } from './training.service';

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'Super_admin', 'CEO', 'HR'];
const VIEW_ROLES = [
  ...MANAGEMENT_ROLES,
  'FINANCE_MANAGER',
  'IT_MANAGER',
  'SALES_MANAGER',
  'EMPLOYEE',
];

@Controller('training')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Post('programs')
  @Roles(...MANAGEMENT_ROLES)
  createProgram(@Body() dto: CreateTrainingDto, @Req() req: any) {
    return this.trainingService.createProgram(dto, req.user.id);
  }

  @Get('programs')
  @Roles(...VIEW_ROLES)
  getPrograms(@Req() req: any) {
    return this.trainingService.getPrograms(req.user);
  }

  @Patch('programs/:id')
  @Roles(...MANAGEMENT_ROLES)
  updateProgram(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTrainingDto,
  ) {
    return this.trainingService.updateProgram(id, dto);
  }

  @Delete('programs/:id')
  @Roles(...MANAGEMENT_ROLES)
  deleteProgram(@Param('id', ParseIntPipe) id: number) {
    return this.trainingService.deleteProgram(id);
  }

  @Post('enroll')
  @Roles(...MANAGEMENT_ROLES)
  enrollEmployees(@Body() dto: EnrollEmployeesDto) {
    return this.trainingService.enrollEmployees(dto);
  }

  @Patch('enrollments/:id')
  @Roles(...VIEW_ROLES)
  updateEnrollment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEnrollmentDto,
    @Req() req: any,
  ) {
    return this.trainingService.updateEnrollmentStatus(req.user.employeeId, id, dto);
  }
}
