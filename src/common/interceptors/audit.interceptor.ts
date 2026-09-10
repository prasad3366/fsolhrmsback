import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuditService } from '../../modules/settings/audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = String(request.method ?? '').toUpperCase();

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const controllerName = context.getClass().name.replace(/Controller$/, '');
      const routePath = request.route?.path ?? request.path ?? controllerName;
      const user = request.user ?? {};

      void this.auditService
        .createLog({
          module: controllerName,
          action: `${method} ${routePath}`,
          userId: Number.isInteger(user.id) ? user.id : undefined,
          userEmail: user.email ?? 'anonymous',
          ipAddress: request.ip,
          payload: request.body,
        })
        .catch(() => undefined);
    }

    return next.handle();
  }
}