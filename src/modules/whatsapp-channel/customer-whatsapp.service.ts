import { Injectable, Logger } from '@nestjs/common';
import { ChatwootAdapter } from '../../integrations/chatwoot/chatwoot.adapter';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';
import { AiProviderService } from '../../ai/ai-provider.service';
import { WhatsAppFormatterService } from './whatsapp-formatter.service';

@Injectable()
export class CustomerWhatsAppService {
  private readonly logger = new Logger(CustomerWhatsAppService.name);

  // Historial en memoria por sesión (teléfono) — máximo 10 turnos
  private readonly sessionHistory = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();

  constructor(
    private readonly chatwoot: ChatwootAdapter,
    private readonly evolution: EvolutionAdapter,
    private readonly aiProvider: AiProviderService,
    private readonly formatter: WhatsAppFormatterService,
  ) {}

  async handle(params: {
    phone: string;
    message: string;
    tenantId: string;
    instanceName: string;
    contactName?: string;
  }): Promise<void> {
    const { phone, message, tenantId, instanceName, contactName } = params;

    // 1. Crear/encontrar contacto en Chatwoot
    const contact = await this.chatwoot.upsertContact({
      name: contactName ?? phone,
      phone: `+${phone}`,
    }).catch(() => null);

    // 2. Obtener historial de sesión
    const sessionKey = `${tenantId}:${phone}`;
    const history = this.sessionHistory.get(sessionKey) ?? [];
    history.push({ role: 'user', content: message });

    // 3. Generar respuesta con IA
    try {
      const result = await this.aiProvider.chat({
        tenantId,
        systemPrompt: `Eres el asistente virtual de atención al cliente de esta empresa en FlowDesk.
Responde de forma amable, profesional y concisa por WhatsApp.
Si no puedes resolver la consulta, di que vas a transferir con un agente humano.
Responde siempre en español.`,
        messages: history.slice(-10), // últimos 10 turnos
        maxTokens: 600,
      });

      history.push({ role: 'assistant', content: result.response });
      this.sessionHistory.set(sessionKey, history.slice(-20));

      const needsHuman = this.detectsEscalation(message, result.response);

      if (needsHuman) {
        // Escalar a Chatwoot con contexto
        await this.escalateToHuman({ phone, tenantId, history, contactName });
        await this.evolution.sendText(
          instanceName,
          `${phone}@s.whatsapp.net`,
          'Te voy a transferir con un agente de nuestro equipo. En un momento te atenderán. ¡Gracias por tu paciencia!',
        );
      } else {
        const formatted = this.formatter.format(result.response);
        await this.evolution.sendText(instanceName, `${phone}@s.whatsapp.net`, formatted);
      }
    } catch (err: any) {
      this.logger.error(`Error en customer WhatsApp ${phone}: ${err.message}`);
      await this.evolution.sendText(
        instanceName,
        `${phone}@s.whatsapp.net`,
        'Lo siento, tuve un problema técnico. En breve un agente te contactará.',
      );
      await this.escalateToHuman({ phone, tenantId, history, contactName });
    }
  }

  private detectsEscalation(userMessage: string, aiResponse: string): boolean {
    const escalationKeywords = [
      'hablar con', 'agente humano', 'persona real', 'no me ayuda', 'quiero queja',
      'transferir', 'supervisor', 'gerente', 'manager', 'escalat',
    ];
    const combined = (userMessage + ' ' + aiResponse).toLowerCase();
    return escalationKeywords.some(kw => combined.includes(kw));
  }

  private async escalateToHuman(params: {
    phone: string;
    tenantId: string;
    history: Array<{ role: string; content: string }>;
    contactName?: string;
  }): Promise<void> {
    try {
      const { phone, history, contactName } = params;

      // Construir resumen del contexto para el agente humano
      const contextSummary = history
        .slice(-6)
        .map(m => `${m.role === 'user' ? 'Cliente' : 'Bot'}: ${m.content}`)
        .join('\n');

      // Crear nota interna en Chatwoot con el contexto de la conversación
      // conversationId 0 = sin conversación activa — la nota se pierde si no hay conv abierta
      // En producción se debe obtener el conversation_id real de Chatwoot
      await this.chatwoot.sendMessage(
        0,
        `📋 Transferencia WhatsApp\nContacto: ${contactName ?? phone} (+${phone})\n\nÚltimos mensajes:\n${contextSummary}`,
        'outgoing',
      ).catch(() => {});
    } catch (err: any) {
      this.logger.warn(`No se pudo crear nota en Chatwoot: ${err.message}`);
    }
  }
}
