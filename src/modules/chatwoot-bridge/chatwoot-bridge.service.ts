import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ChatwootAdapter } from '../../integrations/chatwoot/chatwoot.adapter';
import { AiProviderService } from '../../ai/ai-provider.service';

@Injectable()
export class ChatwootBridgeService {
  private readonly logger = new Logger(ChatwootBridgeService.name);

  // Historial por conversación de Chatwoot
  private readonly conversationHistory = new Map<number, Array<{ role: 'user' | 'assistant'; content: string }>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatwoot: ChatwootAdapter,
    private readonly aiProvider: AiProviderService,
  ) {}

  // Punto de entrada: mensaje entrante de un cliente en Chatwoot
  async handleIncomingMessage(params: {
    conversationId: number;
    message: string;
    contactName?: string;
    tenantId: string;
    channel?: string; // web_widget | email | whatsapp | api
  }): Promise<void> {
    const { conversationId, message, contactName, tenantId } = params;

    const isConfigured = await this.aiProvider.isConfigured(tenantId);
    if (!isConfigured) {
      this.logger.warn(`Tenant ${tenantId} sin proveedor de IA — no se auto-responde`);
      return;
    }

    // Obtener historial de la conversación
    const history = this.conversationHistory.get(conversationId) ?? [];
    history.push({ role: 'user', content: message });

    // Obtener información de la empresa para enriquecer el contexto
    const companyContext = await this.getCompanyContext(tenantId);

    try {
      const result = await this.aiProvider.chat({
        tenantId,
        systemPrompt: `Eres el asistente virtual de atención al cliente.
${companyContext}

Instrucciones:
- Responde de forma amable, profesional y concisa
- Si el cliente pregunta algo que no puedes responder, dile que lo transferirás con un agente
- Si detectas frustración o urgencia, transfiere con un agente humano
- Responde SOLO en español
- Máximo 3 párrafos cortos`,
        messages: history.slice(-8),
        maxTokens: 500,
      });

      history.push({ role: 'assistant', content: result.response });
      this.conversationHistory.set(conversationId, history.slice(-20));

      const needsHuman = this.shouldEscalate(message, result.response);

      if (needsHuman) {
        await this.escalateToHuman(conversationId, tenantId, contactName, history);
      } else {
        // Responder en la conversación de Chatwoot
        await this.chatwoot.sendMessage(conversationId, result.response, 'outgoing');
      }
    } catch (err: any) {
      this.logger.error(`Error auto-respondiendo conversación ${conversationId}: ${err.message}`);
      await this.escalateToHuman(conversationId, tenantId, contactName, history);
    }
  }

  private shouldEscalate(userMessage: string, aiResponse: string): boolean {
    const escalationSignals = [
      'transferir', 'agente', 'humano', 'persona', 'queja', 'reclamo',
      'urgente', 'supervisor', 'gerente', 'problema grave', 'no me ayuda',
      'no puedo responder', 'necesitas hablar', 'te conectaré',
    ];
    const combined = (userMessage + ' ' + aiResponse).toLowerCase();
    return escalationSignals.some(s => combined.includes(s));
  }

  private async escalateToHuman(
    conversationId: number,
    tenantId: string,
    contactName: string | undefined,
    history: Array<{ role: string; content: string }>,
  ): Promise<void> {
    const summary = history
      .slice(-6)
      .map(m => `${m.role === 'user' ? '👤 Cliente' : '🤖 Bot'}: ${m.content.slice(0, 150)}`)
      .join('\n');

    // Nota privada interna con el contexto para el agente humano
    await this.chatwoot.sendMessage(
      conversationId,
      `🔄 *Transferencia a agente humano*\n\nContacto: ${contactName ?? 'Desconocido'}\n\n*Resumen de la conversación:*\n${summary}`,
      'outgoing',
    ).catch(() => {});

    // Asignar al primer agente disponible en Chatwoot
    const availableAgentId = await this.getAvailableChatwootAgent();
    if (availableAgentId) {
      await this.chatwoot.assignConversation(conversationId, availableAgentId).catch(() => {});
    }

    this.logger.log(`Conversación ${conversationId} escalada a agente humano`);
  }

  private async getCompanyContext(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, industry: true, mission: true },
    });

    if (!tenant) return '';

    return `Empresa: ${tenant.name}${tenant.industry ? ` (${tenant.industry})` : ''}
${tenant.mission ? `Misión: ${tenant.mission}` : ''}`.trim();
  }

  private async getAvailableChatwootAgent(): Promise<number | null> {
    // Aquí se podría llamar a la API de Chatwoot para obtener agentes online
    // Por ahora retorna null (sin asignación automática)
    return null;
  }
}
