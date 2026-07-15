import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';

@Injectable()
export class BotConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionAdapter,
  ) {}

  async getConversations(tenantId: string) {
    const convs = await this.prisma.botConversation.findMany({
      where: { tenant_id: tenantId },
      orderBy: [{ last_message_at: 'desc' }, { created_at: 'desc' }],
      include: {
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { content: true, role: true, created_at: true },
        },
      },
    });

    return convs.map(c => ({
      id:           c.id,
      phone:        c.phone,
      contactName:  c.contact_name ?? c.phone,
      mode:         c.mode,
      lastMessage:  c.messages[0]?.content?.slice(0, 100) ?? '',
      lastRole:     c.messages[0]?.role ?? null,
      timeAgo:      formatTimeAgo(c.last_message_at ?? c.created_at),
    }));
  }

  async getMessages(tenantId: string, conversationId: string) {
    const conv = await this.prisma.botConversation.findUnique({
      where: { id: conversationId },
      select: { tenant_id: true, phone: true, contact_name: true, mode: true },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada.');
    if (conv.tenant_id !== tenantId) throw new ForbiddenException();

    const messages = await this.prisma.botMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      select: { id: true, role: true, content: true, created_at: true },
    });

    return {
      conversation: {
        id: conversationId,
        phone: conv.phone,
        contactName: conv.contact_name ?? conv.phone,
        mode: conv.mode,
      },
      messages,
    };
  }

  async sendHumanMessage(tenantId: string, conversationId: string, content: string) {
    const conv = await this.prisma.botConversation.findUnique({
      where: { id: conversationId },
      select: { tenant_id: true, jid: true, instance_name: true, mode: true },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada.');
    if (conv.tenant_id !== tenantId) throw new ForbiddenException();

    // Guardar mensaje como "human"
    await this.prisma.botMessage.create({
      data: { conversation_id: conversationId, role: 'human', content },
    });

    await this.prisma.botConversation.update({
      where: { id: conversationId },
      data: { last_message_at: new Date() },
    });

    // Enviar por WhatsApp via Evolution API
    await this.evolution.sendText(conv.instance_name, conv.jid, content);

    return { ok: true };
  }

  async setMode(tenantId: string, conversationId: string, mode: 'AI' | 'HUMAN') {
    const conv = await this.prisma.botConversation.findUnique({
      where: { id: conversationId },
      select: { tenant_id: true },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada.');
    if (conv.tenant_id !== tenantId) throw new ForbiddenException();

    await this.prisma.botConversation.update({
      where: { id: conversationId },
      data: { mode },
    });

    return { ok: true, mode };
  }

  async deleteConversation(tenantId: string, conversationId: string) {
    const conv = await this.prisma.botConversation.findUnique({
      where: { id: conversationId },
      select: { tenant_id: true },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada.');
    if (conv.tenant_id !== tenantId) throw new ForbiddenException();

    await this.prisma.botConversation.delete({ where: { id: conversationId } });
    return { ok: true };
  }
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}
