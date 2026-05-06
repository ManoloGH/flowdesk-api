import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ChatwootAdapter {
  private readonly logger = new Logger(ChatwootAdapter.name);
  private readonly baseUrl = process.env.CHATWOOT_URL ?? '';
  private readonly apiToken = process.env.CHATWOOT_API_TOKEN ?? '';
  private readonly accountId = process.env.CHATWOOT_ACCOUNT_ID ?? '';

  constructor(private prisma: PrismaService) {}

  private headers() {
    return {
      'api_access_token': this.apiToken,
      'Content-Type': 'application/json',
    };
  }

  // Enviar mensaje a una conversación de Chatwoot
  async sendMessage(conversationId: number, content: string, messageType = 'outgoing') {
    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ content, message_type: messageType, private: false }),
    });
    if (!res.ok) this.logger.error(`Chatwoot sendMessage error: ${res.status}`);
    return res.json();
  }

  // Obtener conversaciones activas de una inbox
  async getConversations(inboxId?: number, status = 'open') {
    const params = new URLSearchParams({ status });
    if (inboxId) params.append('inbox_id', String(inboxId));
    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/conversations?${params}`;
    const res = await fetch(url, { headers: this.headers() });
    return res.json();
  }

  // Asignar conversación a un agente de Chatwoot
  async assignConversation(conversationId: number, agentId: number) {
    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/assignments`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ assignee_id: agentId }),
    });
    return res.json();
  }

  // Buscar o crear contacto en Chatwoot
  async upsertContact(data: { name: string; phone?: string; email?: string }) {
    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/contacts/search?q=${encodeURIComponent(data.phone ?? data.email ?? data.name)}`;
    const search = await fetch(url, { headers: this.headers() });
    const result = await search.json();

    if (result.payload?.length > 0) return result.payload[0];

    const create = await fetch(`${this.baseUrl}/api/v1/accounts/${this.accountId}/contacts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ name: data.name, phone_number: data.phone, email: data.email }),
    });
    return create.json();
  }

  // Procesar webhook entrante de Chatwoot
  async processWebhook(payload: any, tenantId: string, messagesGateway?: any) {
    const { event, conversation, message_created } = payload;

    if (event === 'message_created' && payload.message_type === 'incoming') {
      // Mensaje entrante de cliente → emitir al tenant en FlowDesk
      if (messagesGateway) {
        messagesGateway.deliverToTenant(tenantId, 'chatwoot:message', {
          conversation_id: conversation?.id,
          contact: conversation?.meta?.sender,
          content: payload.content,
          channel: conversation?.channel,
          timestamp: payload.created_at,
        });
      }
    }

    if (event === 'conversation_created') {
      // Nuevo contacto entrante → intentar crear en FlowDesk contacts
      const sender = payload.meta?.sender;
      if (sender) {
        await this.prisma.contact.upsert({
          where: { id: `chatwoot_${sender.id}` } as any,
          create: {
            id: `chatwoot_${sender.id}`,
            tenant_id: tenantId,
            first_name: sender.name?.split(' ')[0] ?? sender.name,
            last_name: sender.name?.split(' ').slice(1).join(' ') || undefined,
            phone: sender.phone_number,
            email: sender.email,
            chatwoot_id: String(sender.id),
            status: 'lead',
          },
          update: { last_contact_at: new Date() },
        } as any);
      }
    }
  }
}
