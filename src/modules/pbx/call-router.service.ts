import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AiProviderService } from '../../ai/ai-provider.service';

export interface RouteDecision {
  action: 'transfer_sip' | 'transfer_pstn' | 'ai_handle' | 'voicemail';
  extension?: string;    // extensión SIP
  phoneNumber?: string;  // número externo
  teamSlotId?: string;
  tenantId: string;
  reason: string;
}

@Injectable()
export class CallRouterService {
  private readonly logger = new Logger(CallRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
  ) {}

  // Decide cómo enrutar la llamada basándose en el saludo del llamante
  async route(params: {
    tenantId: string;
    fromNumber: string;
    greeting?: string; // lo que dijo el llamante al ser atendido por IA
  }): Promise<RouteDecision> {
    const { tenantId, fromNumber, greeting } = params;

    if (!greeting) {
      return { action: 'ai_handle', tenantId, reason: 'Sin saludo — IA responde primero' };
    }

    // Obtener empleados con extensión SIP disponibles
    const employees = await this.prisma.teamSlot.findMany({
      where: {
        tenant_id: tenantId,
        type: 'HUMAN',
        pbx_extension: { not: null },
        status: { in: ['ONLINE', 'AWAY'] },
      },
      select: { id: true, name: true, pbx_extension: true, role: true },
    });

    if (employees.length === 0) {
      return { action: 'voicemail', tenantId, reason: 'Sin empleados disponibles' };
    }

    // Usar IA para detectar la intención y decidir a quién enrutar
    const employeeList = employees
      .map(e => `- ${e.name} (${e.role}): extensión ${e.pbx_extension}`)
      .join('\n');

    const result = await this.aiProvider.chat({
      tenantId,
      systemPrompt: `Eres el sistema de enrutamiento de llamadas. Analiza el mensaje del llamante y decide a qué empleado transferir.

Empleados disponibles:
${employeeList}

Responde SOLO con un JSON: { "employee_id": "id_del_empleado", "reason": "razón breve" }
Si no está claro a quién enrutar, responde: { "employee_id": null, "reason": "razón" }`,
      messages: [{ role: 'user', content: greeting }],
      maxTokens: 200,
    });

    try {
      const decision = JSON.parse(result.response);
      const selected = employees.find(e => e.id === decision.employee_id);

      if (selected?.pbx_extension) {
        return {
          action: 'transfer_sip',
          extension: selected.pbx_extension,
          teamSlotId: selected.id,
          tenantId,
          reason: decision.reason ?? `Transferir a ${selected.name}`,
        };
      }
    } catch {
      this.logger.warn(`No se pudo parsear decisión de routing: ${result.response}`);
    }

    return { action: 'ai_handle', tenantId, reason: 'Sin match — IA continúa' };
  }
}
