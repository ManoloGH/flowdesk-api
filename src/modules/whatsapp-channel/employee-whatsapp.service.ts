import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';
import { AgentConversationsService } from '../agent-conversations/agent-conversations.service';
import { WhatsAppFormatterService } from './whatsapp-formatter.service';

@Injectable()
export class EmployeeWhatsAppService {
  private readonly logger = new Logger(EmployeeWhatsAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionAdapter,
    private readonly agentConversations: AgentConversationsService,
    private readonly formatter: WhatsAppFormatterService,
  ) {}

  async handle(params: {
    phone: string;
    message: string;
    tenantId: string;
    teamSlot: any;
    instanceName: string;
  }): Promise<void> {
    const { phone, message, tenantId, teamSlot, instanceName } = params;

    // Buscar el agente personal del empleado (agent_scope=personal, owner_slot_id=teamSlot.id)
    const personalAgent = await this.prisma.teamSlot.findFirst({
      where: {
        tenant_id: tenantId,
        type: 'AI_AGENT',
        owner_slot_id: teamSlot.id,
        agent_scope: 'personal',
      },
    });

    // Si no tiene agente personal, buscar cualquier agente asignado
    const agent = personalAgent ?? await this.prisma.teamSlot.findFirst({
      where: {
        tenant_id: tenantId,
        type: 'AI_AGENT',
        agent_role: { in: ['focus_agent', 'daily_assistant'] },
      },
    });

    if (!agent) {
      await this.evolution.sendText(instanceName, `${phone}@s.whatsapp.net`,
        'No tienes un agente asignado aún. Configúralo en FlowDesk.');
      return;
    }

    try {
      // Usar sesión de WhatsApp persistente (session_id basado en el canal)
      const sessionKey = `whatsapp:${teamSlot.id}`;
      let conversation = await this.prisma.agentConversation.findFirst({
        where: { agent_id: agent.id, human_id: teamSlot.id, session_id: sessionKey },
      });

      const chatDto = {
        message,
        session_id: conversation?.id,
      };

      const result = await this.agentConversations.chat(tenantId, teamSlot.id, agent.id, chatDto as any);
      const formatted = this.formatter.format(result.response);
      await this.evolution.sendText(instanceName, `${phone}@s.whatsapp.net`, formatted);
    } catch (err: any) {
      this.logger.error(`Error respondiendo a empleado ${teamSlot.id}: ${err.message}`);
      await this.evolution.sendText(instanceName, `${phone}@s.whatsapp.net`,
        'Hubo un error al procesar tu mensaje. Intenta de nuevo.');
    }
  }
}
