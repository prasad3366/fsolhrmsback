import {
  Controller,
  Post,
  Body,
  Req,
  Param,
  UseGuards,
  Get,
} from '@nestjs/common';
import { WfhService } from './wfh.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestWfhDto } from './dto/wfh-request.dto';

@Controller('wfh')
@UseGuards(JwtAuthGuard)
export class WfhController {
  constructor(private service: WfhService) {}

  // Employee Request WFH
  @Post('request')
  request(@Req() req, @Body() dto: RequestWfhDto) {
    return this.service.request(req.user.employeeId, dto);
  }

  // HR Approve
  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.service.approve(Number(id));
  }

  // HR Reject
  @Post(':id/reject')
  reject(@Param('id') id: string) {
    return this.service.reject(Number(id));
  }

  // HR View All
  @Get('all')
  getAll() {
    return this.service.getAll();
  }

  // Employee View Own Requests
  @Get('my')
  getMine(@Req() req) {
    return this.service.getMyRequests(req.user.employeeId);
  }
}
