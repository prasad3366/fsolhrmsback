import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
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

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === '') {
      throw new Error(`${name} environment variable is required`);
    }
    return value;
  }

  // ---------- TOKEN GENERATOR ----------
  private async generateTokens(user: {
    id: number;
    email: string;
    role: Role;
    updatedAt?: Date | string | null;
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      userUpdatedAt: user.updatedAt ? new Date(user.updatedAt).getTime() : Date.now(),
    };

    const securityPolicy = await this.prisma.securityPolicy.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
      select: { sessionTimeoutMins: true },
    });
    // Sign refresh token explicitly with refresh secret to avoid relying on module defaults
    const refreshSecret = this.requireEnv('JWT_REFRESH_SECRET') as jwtLib.Secret;
    const refreshOptions: jwtLib.SignOptions = {
      expiresIn: (process.env.JWT_REFRESH_EXPIRY as jwtLib.SignOptions['expiresIn']) || '7d',
    };

    // cast to any to avoid overload resolution issues in some @types/jsonwebtoken versions
    const refreshToken = (jwtLib as any).sign(payload as any, refreshSecret, refreshOptions);

    // store hashed refresh token (bcrypt rounds configurable via env)
    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS) || 10;
    const hashed = await bcrypt.hash(refreshToken, bcryptRounds);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashed },
    });

    const accessOptions: SignOptions = {
      expiresIn: securityPolicy.sessionTimeoutMins > 0
        ? `${securityPolicy.sessionTimeoutMins}m`
        : (process.env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn']) || '1d',
    };
    const accessToken = this.jwt.sign({
      ...payload,
      userUpdatedAt: updatedUser?.updatedAt
        ? new Date(updatedUser.updatedAt).getTime()
        : payload.userUpdatedAt,
    } as any, accessOptions);

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

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked');
    }

    // Check if employee status is INACTIVE
    if (user.employee && user.employee.status === 'INACTIVE') {
      throw new UnauthorizedException('Your account has been deactivated. Please contact HR.');
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      const securityPolicy = await this.prisma.securityPolicy.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
        select: { maxFailedLogins: true, accountLockMins: true },
      });
      const failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
      const shouldLock = failedLoginAttempts >= securityPolicy.maxFailedLogins;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts,
          lockedUntil: shouldLock
            ? new Date(Date.now() + securityPolicy.accountLockMins * 60_000)
            : null,
        },
      });
      throw new UnauthorizedException(
        shouldLock ? 'Account temporarily locked' : 'Invalid credentials',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

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
      const refreshSecret = this.requireEnv('JWT_REFRESH_SECRET');
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

  private generateSecureOtp(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  private async hashResetToken(token: string): Promise<string> {
    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS) || 10;
    return bcrypt.hash(token, bcryptRounds);
  }

  private async clearResetToken(userId: number) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        resetOtp: null,
        resetOtpExpires: null,
      },
    });
  }

  // ---------- FORGOT PASSWORD (OTP FLOW) ----------
  async forgotPassword(email: string, newPassword?: string, otp?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return {
        message: 'If the email is registered, a reset link has been sent.',
      };
    }

    // Step 1: Request OTP (no OTP or newPassword provided)
    if (!otp && !newPassword) {
      const generatedOtp = this.generateSecureOtp();
      const expires = new Date(Date.now() + 5 * 60 * 1000);
      const hashedOtp = await this.hashResetToken(generatedOtp);

      await this.prisma.user.update({
        where: { email },
        data: { resetOtp: hashedOtp, resetOtpExpires: expires },
      });

      const employee = await this.prisma.employee.findUnique({
        where: { userId: user.id },
        select: { firstName: true },
      });
      const firstName = employee?.firstName || 'User';

      await this.mailService.sendOtp(email, generatedOtp, firstName);
      return { message: 'If the email is registered, a reset link has been sent.' };
    }

    // Step 2: Verify OTP and set new password
    if (otp && newPassword) {
      if (!user.resetOtp || !user.resetOtpExpires) {
        throw new BadRequestException('Invalid or expired OTP');
      }

      if (user.resetOtpExpires < new Date()) {
        await this.clearResetToken(user.id);
        throw new BadRequestException('OTP expired');
      }

      const validOtp = await bcrypt.compare(otp, user.resetOtp);
      if (!validOtp) {
        throw new BadRequestException('Invalid OTP');
      }

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
