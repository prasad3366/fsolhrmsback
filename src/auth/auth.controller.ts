import {
  Body,
  Controller,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  // ---------- LOGIN ----------
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.service.login(dto.email, dto.password);
  }

  // ---------- REFRESH ----------
  @Post('refresh')
  refresh(@Body('refreshToken') token: string) {
    return this.service.refreshToken(token);
  }

  // ---------- LOGOUT ----------
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@Req() req) {
    return this.service.logout(req.user.id);
  }

  // ---------- FORGOT PASSWORD ----------
  @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) {
    // Accepts: email (required), otp (optional), newPassword (optional)
    return this.service.forgotPassword(dto.email, dto.newPassword, dto.otp);
  }
}