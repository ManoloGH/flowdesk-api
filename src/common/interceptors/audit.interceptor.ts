import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../database/prisma.service';
// eslint-disable-next-line @typescript-eslint/no-explicit-any

// Acciones que se registran automáticamente en audit_logs
const AUDITABLE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user, ip, body } = request;

    if (!user || !AUDITABLE_METHODS.includes(method)) {
      return next.handle();
    }

    const action = this.resolveAction(method, url);
    const resourceType = this.resolveResourceType(url);

    return next.handle().pipe(
      tap((responseData) => {
        this.prisma.auditLog
          .create({
            data: {
              tenant_id: user.tenant_id,
              actor_id: user.slot_id,
              action,
              resource_type: resourceType,
              resource_id: responseData?.id ?? null,
              payload: { body, response: responseData },
              ip_address: ip,
            },
          })
          .catch(() => {}); // nunca rompe el flujo principal
      }),
    );
  }

  private resolveAction(method: string, url: string): string {
    const segment = url.split('/').filter(Boolean)[1] ?? 'resource';
    const actions: Record<string, string> = {
      POST: `created_${segment}`,
      PUT: `updated_${segment}`,
      PATCH: `updated_${segment}`,
      DELETE: `deleted_${segment}`,
    };
    return actions[method] ?? `action_on_${segment}`;
  }

  private resolveResourceType(url: string): string {
    return url.split('/').filter(Boolean)[1] ?? 'unknown';
  }
}
