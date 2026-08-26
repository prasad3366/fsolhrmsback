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
import * as jwtLib from 'jsonwebtoken';
import { SignOptions } from 'jsonwebtoken';
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

    const accessOptions: SignOptions = {
      expiresIn: (process.env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn']) || '1d',
    };

    const accessToken = this.jwt.sign(payload as any, accessOptions);

    // Sign refresh token explicitly with refresh secret to avoid relying on module defaults
    const refreshSecret = (process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET) as jwtLib.Secret;
    const refreshOptions: jwtLib.SignOptions = {
      expiresIn: (process.env.JWT_REFRESH_EXPIRY as jwtLib.SignOptions['expiresIn']) || '7d',
    };

    // cast to any to avoid overload resolution issues in some @types/jsonwebtoken versions
    const refreshToken = (jwtLib as any).sign(payload as any, refreshSecret, refreshOptions);

    // store hashed refresh token (bcrypt rounds configurable via env)
    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS) || 10;
    const hashed = await bcrypt.hash(refreshToken, bcryptRounds);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashed },
    });

    return { accessToken, refreshToken };
  }

  // ---------- LOGIN ----------
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ 
      where: { email },
      include: { employee: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if employee status is INACTIVE
    if (user.employee && user.employee.status === 'INACTIVE') {
      throw new UnauthorizedException('Your account has been deactivated. Please contact HR.');
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
      // Verify refresh token with explicit refresh secret
      const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
      const payload = jwtLib.verify(token, refreshSecret as string) as any;

      const userId = Number(payload.sub);
      if (Number.isNaN(userId)) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { employee: true },
      });

      if (!user || !user.refreshToken || !user.isActive) {
        throw new UnauthorizedException();
      }

      // Check if employee status is INACTIVE
      if (user.employee && user.employee.status === 'INACTIVE') {
        throw new UnauthorizedException('Your account has been deactivated.');
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

      const bcryptRounds = Number(process.env.BCRYPT_ROUNDS) || 10;
      const hashed = await bcrypt.hash(newPassword, bcryptRounds);
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
