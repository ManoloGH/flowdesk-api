import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface AuditEntry {
  tenantId: string;
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload?: Record<string, any>;
  ipAddress?: string;
}

// Acciones estándar — usar estas constantes para evitar typos
export const AuditAction = {
  AUTH_LOGIN: 'AUTH_LOGIN',
  AUTH_LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  AUTH_LOGOUT: 'AUTH_LOGOUT',
  AUTH_PASSWORD_CHANGED: 'AUTH_PASSWORD_CHANGED',
  TENANT_PROVISIONED: 'TENANT_PROVISIONED',
  INTEGRATION_CONNECTED: 'INTEGRATION_CONNECTED',
  INTEGRATION_DISCONNECTED: 'INTEGRATION_DISCONNECTED',
  AGENT_CREATED: 'AGENT_CREATED',
  AGENT_DELETED: 'AGENT_DELETED',
} as const;

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  // Fire-and-forget — nunca bloquea la respuesta principal.
  // Si falla, se silencia para no afectar al usuario.
  log(entry: AuditEntry): void {
    this.prisma.auditLog
      .create({
        data: {
          tenant_id: entry.tenantId,
          actor_id: entry.actorId ?? null,
          action: entry.action,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId ?? null,
          payload: entry.payload ?? undefined,
          ip_address: entry.ipAddress ?? null,
        },
      })
      .catch(() => {});
  }
}
