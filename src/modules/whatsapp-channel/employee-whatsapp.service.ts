import { Injectable, Logger } from '@nestjs/common';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';
import { PersonalAssistantService } from '../personal-assistant/personal-assistant.service';
import { WhatsAppFormatterService } from './whatsapp-formatter.service';

@Injectable()
export class EmployeeWhatsAppService {
  private readonly logger = new Logger(EmployeeWhatsAppService.name);

  // WhatsApp session_id persistente por empleado (sobrevive reinicios del día)
  private readonly waSessions = new Map<string, string>();

  constructor(
    private readonly evolution: EvolutionAdapter,
    private readonly personalAssistant: PersonalAssistantService,
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
    const jid = `${phone}@s.whatsapp.net`;

    try {
      const sessionKey = `wa:${tenantId}:${teamSlot.id}`;
      const sessionId  = this.waSessions.get(sessionKey);

      const result = await this.personalAssistant.chat(tenantId, teamSlot.id, {
        message,
        session_id: sessionId,
      });

      this.waSessions.set(sessionKey, result.session_id);

      await this.evolution.sendText(instanceName, jid, this.formatter.format(result.text));
    } catch (err: any) {
      this.logger.error(`Error respondiendo a empleado ${teamSlot.id}: ${err.message}`);
      await this.evolution.sendText(instanceName, jid,
        'Hubo un problema al procesar tu mensaje. Intenta de nuevo en un momento.');
    }
  }
}
