import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mailService: MailService,
  ) {}

  // ---------- DASHBOARD ----------
  private dashboard(role: Role) {
    return `/dashboard/${role.toLowerCase()}`;
  }

  // ---------- TOKEN GENERATOR ----------
  private async generateTokens(user: {
    id: number;
    email: string;
    role: Role;
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwt.sign(
      payload as any,
      {
        expiresIn: process.env.JWT_ACCESS_EXPIRY as string,
      } as any,
    );

    const refreshToken = this.jwt.sign(
      payload as any,
      {
        expiresIn: process.env.JWT_REFRESH_EXPIRY as string,
        secret: process.env.JWT_REFRESH_SECRET,
      } as any,
    );

    // store hashed refresh token
    const hashed = await bcrypt.hash(refreshToken, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashed },
    });

    return { accessToken, refreshToken };
  }

  // ---------- LOGIN ----------
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokens(user);

    return {
      message: 'Login successful',
      role: user.role,
      dashboard: this.dashboard(user.role),
      ...tokens,
    };
  }

  // ---------- REFRESH ----------
  async refreshToken(token: string) {
    try {
      const payload = this.jwt.verify(token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.refreshToken || !user.isActive) {
        throw new UnauthorizedException();
      }

      const valid = await bcrypt.compare(token, user.refreshToken);
      if (!valid) throw new UnauthorizedException();

      const tokens = await this.generateTokens(user);

      return {
        role: user.role,
        dashboard: this.dashboard(user.role),
        ...tokens,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  // ---------- LOGOUT ----------
  async logout(userId: number) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    return { message: 'Logout successful' };
  }

  // ---------- FORGOT PASSWORD (OTP FLOW) ----------
  async forgotPassword(email: string, newPassword?: string, otp?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    // Step 1: Request OTP (no OTP or newPassword provided)
    if (!otp && !newPassword) {
      // Generate 6-digit OTP
      const generatedOtp = Math.floor(
        100000 + Math.random() * 900000,
      ).toString();
      const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry
      await this.prisma.user.update({
        where: { email },
        data: { resetOtp: generatedOtp, resetOtpExpires: expires },
      });
      // Get employee's firstName
      const employee = await this.prisma.employee.findUnique({
        where: { userId: user.id },
        select: { firstName: true },
      });
      const firstName = employee?.firstName || 'User';

      // Send OTP to email
      await this.mailService.sendOtp(email, generatedOtp, firstName);
      return { message: 'OTP sent to your email' };
    }

    // Step 2: Verify OTP and set new password
    if (otp && newPassword) {
      if (!user.resetOtp || !user.resetOtpExpires)
        throw new BadRequestException('No OTP requested');
      if (user.resetOtp !== otp) throw new BadRequestException('Invalid OTP');
      if (user.resetOtpExpires < new Date())
        throw new BadRequestException('OTP expired');

      const hashed = await bcrypt.hash(newPassword, 10);
      await this.prisma.user.update({
        where: { email },
        data: {
          password: hashed,
          refreshToken: null, 
          resetOtp: null,
          resetOtpExpires: null,
        },
      });
      return { message: 'Password updated successfully' };
    }

    throw new BadRequestException('Invalid request');
  }
}
