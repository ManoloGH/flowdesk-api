import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Extrae el tenant_id del JWT. Para platform_admin, acepta header X-Tenant-Id
// para operar en cualquier tenant sin necesidad de impersonación.
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    if (user?.platform_admin) {
      const override = request.headers['x-tenant-id'];
      if (override) return override as string;
    }
    return user?.tenant_id;
  },
);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
