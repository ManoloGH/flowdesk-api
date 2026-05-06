import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

// Valida que el tenant del JWT exista y esté activo
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    if (!user?.tenant_id) return false;

    const tenant = await this.prisma.tenant.findFirst({
      where: { id: user.tenant_id, status: 'active' },
      select: { id: true },
    });

    if (!tenant) {
      throw new ForbiddenException('Empresa inactiva o no encontrada');
    }

    return true;
  }
}
