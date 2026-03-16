import { Controller, Get, Patch, Post, Req, Body, Param, Query, UseGuards } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateLeaveDto } from './dto/create-leave.dto';

@Controller('leaves')
@UseGuards(JwtAuthGuard)
export class LeaveController {

  constructor(private readonly service: LeaveService) {}

  @Post('apply')
  apply(@Req() req, @Body() dto: CreateLeaveDto) {
    return this.service.applyLeave(req.user.employeeId, dto);
  }

  @Patch('approve/:id')
  approve(@Req() req, @Param('id') id: string) {
    return this.service.approveLeave(+id, req.user.role);
  }

  @Patch('reject/:id')
  reject(@Req() req, @Param('id') id: string, @Body('remarks') remarks: string) {
    return this.service.rejectLeave(+id, remarks, req.user.role);
  }

  @Get('history')
  history(@Req() req) {
    return this.service.leaveHistory(req.user.role, req.user.employeeId);
  }

  @Get('pending')
  pending(@Req() req) {
    return this.service.pendingRequests(req.user.role);
  }

  @Get('balance')
  balance(@Req() req, @Query('yearStart') yearStart: string) {
    return this.service.getBalance(
      req.user.role,
      req.user.employeeId,
      +yearStart,
    );
  }

@Get('self/history')
selfHistory(@Req() req) {
  return this.service.selfLeaveHistory(req.user.employeeId);
}


@Get('self/balance')
selfBalance(@Req() req, @Query('yearStart') yearStart: string) {
  return this.service.selfBalance(
    req.user.employeeId,
    +yearStart,
  );
}


@Get('self/monthly')
monthly(
  @Req() req,
  @Query('month') month: string,
  @Query('year') year: string,
) {
  return this.service.monthlyLeaves(
    req.user.employeeId,
    +month,
    +year,
  );
}

}
