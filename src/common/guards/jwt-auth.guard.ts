import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1️⃣ Call default JWT strategy
    const can = (await super.canActivate(context)) as boolean;
    if (!can) return false;

    // 2️⃣ Extract request
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) throw new UnauthorizedException('No token found');

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });

      // 3️⃣ Attach user to request
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { employee: true },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }

      request.user = {
        id: user.id,
        role: user.role,
        employeeId: user.employee?.id || null,
        email: user.email,
      };

      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: any): string | null {
    if (
      request.headers.authorization &&
      request.headers.authorization.startsWith('Bearer ')
    ) {
      return request.headers.authorization.split(' ')[1];
    }
    return null;
  }
}
