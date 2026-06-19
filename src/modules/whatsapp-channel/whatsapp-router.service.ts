import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export type WhatsAppIdentity =
  | { type: 'owner';     tenantId: string; secretaryConfig: any }
  | { type: 'operative'; tenantId: string; teamSlot: any }
  | { type: 'employee';  tenantId: string; teamSlot: any }
  | { type: 'external';  tenantId: string }
  | { type: 'unknown' };

@Injectable()
export class WhatsAppRouterService {
  constructor(private readonly prisma: PrismaService) {}

  async identify(phone: string, instanceName: string): Promise<WhatsAppIdentity> {
    // Resolver tenant por instancia de Evolution API
    const integration = await this.prisma.integration.findFirst({
      where: {
        provider: 'whatsapp' as any,
        config: { path: ['instance_name'], equals: instanceName },
      },
      select: { tenant_id: true },
    });

    if (!integration) return { type: 'unknown' };
    const tenantId = integration.tenant_id;

    // 1. ¿Es el dueño? (registrado en SecretaryConfig)
    const secretaryConfig = await this.prisma.secretaryConfig.findUnique({
      where: { tenant_id: tenantId },
    });
    const normalizedPhone = this.normalizePhone(phone);
    if (secretaryConfig?.owner_phone && this.normalizePhone(secretaryConfig.owner_phone) === normalizedPhone) {
      return { type: 'owner', tenantId, secretaryConfig };
    }

    // 2. ¿Es un empleado registrado?
    const employeeSlot = await this.prisma.teamSlot.findFirst({
      where: {
        tenant_id: tenantId,
        type: 'HUMAN',
        whatsapp_phone: { not: null },
      },
    });

    // Buscar coincidencia por número normalizado
    const allHumans = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, type: 'HUMAN', whatsapp_phone: { not: null } },
      select: { id: true, whatsapp_phone: true, name: true, role: true, agent_config: true },
    });

    const matchedEmployee = allHumans.find(
      h => h.whatsapp_phone && this.normalizePhone(h.whatsapp_phone) === normalizedPhone,
    );

    if (matchedEmployee) {
      const cfg = matchedEmployee.agent_config as any;
      if (cfg?.worker_type === 'operative') {
        return { type: 'operative', tenantId, teamSlot: matchedEmployee };
      }
      return { type: 'employee', tenantId, teamSlot: matchedEmployee };
    }

    // 3. Cliente externo → Chatwoot
    return { type: 'external', tenantId };
  }

  // Normaliza teléfonos: elimina +, espacios, guiones y deja solo dígitos
  private normalizePhone(phone: string): string {
    return phone.replace(/[\s\-\+\(\)]/g, '');
  }
}
