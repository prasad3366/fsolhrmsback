import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as jwtLib from 'jsonwebtoken';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

describe('AuthService password reset flow', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    employee: {
      findUnique: jest.Mock;
    };
    securityPolicy: {
      upsert: jest.Mock;
    };
  };
  let mailService: {
    sendOtp: jest.Mock;
  };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      securityPolicy: {
        upsert: jest.fn().mockResolvedValue({ sessionTimeoutMins: 60 }),
      },
      employee: {
        findUnique: jest.fn(),
      },
    };
    mailService = {
      sendOtp: jest.fn(),
    };
    service = new AuthService(prisma as any, {} as any, mailService as any);
  });

  it('valid reset token succeeds', async () => {
    const validOtp = '123456';
    const hashedOtp = await bcrypt.hash(validOtp, 10);

    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'user@example.com',
      resetOtp: hashedOtp,
      resetOtpExpires: new Date(Date.now() + 60_000),
    });
    prisma.user.update.mockResolvedValue({ id: 7 });

    await expect(
      service.forgotPassword('user@example.com', 'NewPass!23', validOtp),
    ).resolves.toEqual({ message: 'Password updated successfully' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'user@example.com' },
        data: expect.objectContaining({
          refreshToken: null,
          resetOtp: null,
          resetOtpExpires: null,
        }),
      }),
    );

    const updateData = prisma.user.update.mock.calls[0][0].data;
    expect(updateData.password).not.toBe('NewPass!23');
    expect(await bcrypt.compare('NewPass!23', updateData.password)).toBe(true);
    expect(updateData.role).toBeUndefined();
    expect(updateData.employee).toBeUndefined();
  });

  it('invalid token fails', async () => {
    const validOtp = '123456';
    const hashedOtp = await bcrypt.hash(validOtp, 10);

    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'user@example.com',
      resetOtp: hashedOtp,
      resetOtpExpires: new Date(Date.now() + 60_000),
    });

    await expect(
      service.forgotPassword('user@example.com', 'NewPass!23', 'wrongotp'),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('expired token fails', async () => {
    const validOtp = '123456';
    const hashedOtp = await bcrypt.hash(validOtp, 10);

    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'user@example.com',
      resetOtp: hashedOtp,
      resetOtpExpires: new Date(Date.now() - 60_000),
    });

    await expect(
      service.forgotPassword('user@example.com', 'NewPass!23', validOtp),
    ).rejects.toThrow('OTP expired');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({
          resetOtp: null,
          resetOtpExpires: null,
        }),
      }),
    );
  });

  it('already-used token fails', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'user@example.com',
      resetOtp: null,
      resetOtpExpires: null,
    });

    await expect(
      service.forgotPassword('user@example.com', 'NewPass!23', '123456'),
    ).rejects.toThrow('Invalid or expired OTP');
  });

  it('successful reset makes the token unusable again', async () => {
    const validOtp = '123456';
    const hashedOtp = await bcrypt.hash(validOtp, 10);

    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 7,
        email: 'user@example.com',
        resetOtp: hashedOtp,
        resetOtpExpires: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce({
        id: 7,
        email: 'user@example.com',
        resetOtp: null,
        resetOtpExpires: null,
      });

    prisma.user.update.mockResolvedValue({ id: 7 });

    await expect(
      service.forgotPassword('user@example.com', 'NewPass!23', validOtp),
    ).resolves.toEqual({ message: 'Password updated successfully' });

    await expect(
      service.forgotPassword('user@example.com', 'AnotherPass!99', validOtp),
    ).rejects.toThrow('Invalid or expired OTP');
  });

  it('requesting reset does not reveal whether the email exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.forgotPassword('missing@example.com')).resolves.toEqual({
      message: 'If the email is registered, a reset link has been sent.',
    });
  });

  it('reset flow does not alter role or employee data', async () => {
    const validOtp = '123456';
    const hashedOtp = await bcrypt.hash(validOtp, 10);

    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'user@example.com',
      resetOtp: hashedOtp,
      resetOtpExpires: new Date(Date.now() + 60_000),
    });
    prisma.user.update.mockResolvedValue({ id: 7 });

    await service.forgotPassword('user@example.com', 'NewPass!23', validOtp);

    const updateData = prisma.user.update.mock.calls[0][0].data;
    expect(updateData).toMatchObject({
      password: expect.any(String),
      refreshToken: null,
      resetOtp: null,
      resetOtpExpires: null,
    });
    expect(updateData.role).toBeUndefined();
    expect(updateData.employee).toBeUndefined();
  });

  it('wrong or invalid token cannot change any user password', async () => {
    const validOtp = '123456';
    const hashedOtp = await bcrypt.hash(validOtp, 10);

    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'user@example.com',
      resetOtp: hashedOtp,
      resetOtpExpires: new Date(Date.now() + 60_000),
    });

    await expect(
      service.forgotPassword('user@example.com', 'BadPass!44', 'wrongotp'),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects JWTs issued before the current user update timestamp', async () => {
    const strategy = new JwtStrategy({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          email: 'user@example.com',
          role: 'EMPLOYEE',
          isActive: true,
          updatedAt: new Date('2026-09-12T12:00:00Z'),
          employee: { id: 10, status: 'ACTIVE' },
        }),
      },
    } as any);

    await expect(
      strategy.validate({
        sub: 7,
        email: 'user@example.com',
        role: 'EMPLOYEE',
        userUpdatedAt: new Date('2026-09-11T12:00:00Z').getTime(),
      }),
    ).rejects.toThrow('Token invalidated after password change');
  });

  it('accepts a fresh JWT whose userUpdatedAt matches the current database state', async () => {
    const strategy = new JwtStrategy({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          email: 'user@example.com',
          role: 'EMPLOYEE',
          isActive: true,
          updatedAt: new Date('2026-09-12T12:00:00Z'),
          employee: { id: 10, status: 'ACTIVE' },
        }),
      },
    } as any);

    await expect(
      strategy.validate({
        sub: 7,
        email: 'user@example.com',
        role: 'EMPLOYEE',
        userUpdatedAt: new Date('2026-09-12T12:00:00Z').getTime(),
      }),
    ).resolves.toMatchObject({ id: 7, email: 'user@example.com' });
  });

  it('returns a refresh access token with the post-rotation user revision', async () => {
    const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

    try {
      const beforeRotation = new Date('2026-09-12T12:00:00.000Z');
      const afterRotation = new Date('2026-09-12T12:00:01.000Z');
      const refreshToken = jwtLib.sign(
        { sub: 7, userUpdatedAt: beforeRotation.getTime() },
        process.env.JWT_REFRESH_SECRET,
      );
      const hashedRefreshToken = await bcrypt.hash(refreshToken, 4);
      const user = {
        id: 7,
        email: 'user@example.com',
        role: 'EMPLOYEE',
        isActive: true,
        updatedAt: beforeRotation,
        refreshToken: hashedRefreshToken,
        employee: { id: 10, status: 'ACTIVE' },
      };
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({ ...user, updatedAt: afterRotation });

      const refreshService = new AuthService(
        prisma as any,
        new JwtService({ secret: 'test-access-secret' }),
        mailService as any,
      );
      const result = await refreshService.refreshToken(refreshToken);
      const accessPayload = jwtLib.decode(result.accessToken) as any;

      const strategy = new JwtStrategy({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            ...user,
            updatedAt: afterRotation,
          }),
        },
      } as any);

      await expect(strategy.validate(accessPayload)).resolves.toMatchObject({ id: 7 });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { refreshToken: expect.any(String) },
      });
      expect(accessPayload.userUpdatedAt).toBe(afterRotation.getTime());
    } finally {
      if (originalRefreshSecret === undefined) {
        delete process.env.JWT_REFRESH_SECRET;
      } else {
        process.env.JWT_REFRESH_SECRET = originalRefreshSecret;
      }
    }
  });

  it('keeps older access tokens invalid after a password reset', async () => {
    const validOtp = '123456';
    const hashedOtp = await bcrypt.hash(validOtp, 4);
    const beforeReset = new Date('2026-09-12T12:00:00.000Z');
    const afterReset = new Date('2026-09-12T12:00:01.000Z');
    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'user@example.com',
      resetOtp: hashedOtp,
      resetOtpExpires: new Date(Date.now() + 60_000),
      updatedAt: beforeReset,
    });
    prisma.user.update.mockResolvedValue({ id: 7, updatedAt: afterReset });

    await expect(
      service.forgotPassword('user@example.com', 'NewPass!23', validOtp),
    ).resolves.toEqual({ message: 'Password updated successfully' });

    const strategy = new JwtStrategy({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          email: 'user@example.com',
          role: 'EMPLOYEE',
          isActive: true,
          updatedAt: afterReset,
          employee: { id: 10, status: 'ACTIVE' },
        }),
      },
    } as any);

    await expect(
      strategy.validate({ sub: 7, userUpdatedAt: beforeReset.getTime() }),
    ).rejects.toThrow('Token invalidated after password change');
  });
});
