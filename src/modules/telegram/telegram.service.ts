import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AgentConversationsService } from '../agent-conversations/agent-conversations.service';

@Injectable()
export class TelegramService {
  // Códigos temporales de vinculación: code → { slotId, tenantId, expiresAt }
  private pendingCodes = new Map<string, { slotId: string; tenantId: string; expiresAt: number }>();

  constructor(
    private prisma: PrismaService,
    private agentConversations: AgentConversationsService,
  ) {}

  // ─── Vinculación de cuenta ────────────────────────────────────────────────

  async generateConnectCode(slotId: string, tenantId: string) {
    // Limpiar códigos anteriores del mismo usuario
    for (const [code, data] of this.pendingCodes) {
      if (data.slotId === slotId) this.pendingCodes.delete(code);
    }

    const code = `FD${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    this.pendingCodes.set(code, {
      slotId,
      tenantId,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutos
    });

    const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? 'FlowDeskCEOBot';
    return {
      code,
      bot_username: botUsername,
      link: `https://t.me/${botUsername}?start=${code}`,
      expires_in: 300,
      instruction: `Abre Telegram y envía /start ${code} al bot @${botUsername}`,
    };
  }

  async getStatus(slotId: string) {
    const slot = await this.prisma.teamSlot.findUnique({
      where: { id: slotId },
      select: { permissions: true },
    });
    const perms = (slot?.permissions as any) ?? {};
    return {
      connected: !!perms.telegram_chat_id,
      linked_at: perms.telegram_linked_at ?? null,
    };
  }

  async disconnect(slotId: string) {
    const slot = await this.prisma.teamSlot.findUnique({
      where: { id: slotId },
      select: { permissions: true },
    });
    const perms = { ...((slot?.permissions as any) ?? {}) };
    delete perms.telegram_chat_id;
    delete perms.telegram_linked_at;
    delete perms.telegram_session_id;

    await this.prisma.teamSlot.update({
      where: { id: slotId },
      data: { permissions: perms },
    });
    return { disconnected: true };
  }

  // ─── Webhook de Telegram ─────────────────────────────────────────────────

  async handleWebhook(body: any) {
    const message = body?.message ?? body?.edited_message;
    if (!message) return;

    const chatId = String(message.chat?.id ?? '');
    const text = (message.text ?? '').trim();
    if (!chatId || !text) return;

    // Comando /start — vinculación o bienvenida
    if (text.startsWith('/start')) {
      await this.handleStart(chatId, text);
      return;
    }

    // Cualquier otro mensaje → CEO Agent
    await this.routeToCeo(chatId, text);
  }

  private async handleStart(chatId: string, text: string) {
    const code = text.split(' ')[1]?.toUpperCase();

    if (!code) {
      await this.sendMessage(
        chatId,
        '👋 Hola! Genera un código desde tu FlowDesk y envíame */start CÓDIGO* para vincular tu cuenta.',
      );
      return;
    }

    const pending = this.pendingCodes.get(code);
    if (!pending || Date.now() > pending.expiresAt) {
      await this.sendMessage(chatId, '❌ Código inválido o expirado. Genera uno nuevo desde FlowDesk → Desk.');
      return;
    }

    this.pendingCodes.delete(code);

    const slot = await this.prisma.teamSlot.findUnique({
      where: { id: pending.slotId },
      select: { name: true, permissions: true },
    });

    const perms = { ...((slot?.permissions as any) ?? {}) };
    perms.telegram_chat_id = chatId;
    perms.telegram_linked_at = new Date().toISOString();

    await this.prisma.teamSlot.update({
      where: { id: pending.slotId },
      data: { permissions: perms },
    });

    // Obtener nombre del CEO Agent
    const ceoAgent = await this.prisma.teamSlot.findFirst({
      where: { owner_slot_id: pending.slotId, tenant_id: pending.tenantId, agent_role: 'ceo' },
      select: { name: true },
    });

    await this.sendMessage(
      chatId,
      `✅ ¡Cuenta vinculada, ${slot?.name}!\n\n` +
      `${ceoAgent ? `Soy *${ceoAgent.name}*, tu CEO Agent.` : 'Tu CEO Agent está listo.'} ` +
      `Escríbeme lo que necesites — tengo acceso a todas tus tareas, metas y equipo.\n\n` +
      `Prueba: _"¿Cómo voy hoy?"_ o _"¿Qué tengo vencido?"_`,
    );
  }

  private async routeToCeo(chatId: string, text: string) {
    // Buscar usuario por telegram_chat_id en permissions
    const slot = await this.prisma.teamSlot.findFirst({
      where: {
        type: 'HUMAN',
        permissions: { path: ['telegram_chat_id'], equals: chatId },
      },
      select: { id: true, name: true, tenant_id: true, permissions: true },
    });

    if (!slot) {
      await this.sendMessage(
        chatId,
        '⚠️ No encontré tu cuenta vinculada. Ve a FlowDesk → Desk y conecta Telegram.',
      );
      return;
    }

    const ceoAgent = await this.prisma.teamSlot.findFirst({
      where: { owner_slot_id: slot.id, tenant_id: slot.tenant_id, agent_role: 'ceo', type: 'AI_AGENT' },
      select: { id: true, name: true },
    });

    if (!ceoAgent) {
      await this.sendMessage(chatId, '⚠️ No encontré tu agente CEO. Verifica tu perfil en FlowDesk.');
      return;
    }

    await this.sendChatAction(chatId, 'typing');

    const perms = (slot.permissions as any) ?? {};
    const sessionId: string | undefined = perms.telegram_session_id;

    try {
      const result = await this.agentConversations.chat(
        slot.tenant_id,
        slot.id,
        ceoAgent.id,
        { message: `[vía Telegram] ${text}`, session_id: sessionId } as any,
      );

      // Guardar session para continuidad
      if (result.conversation_id && !sessionId) {
        const updatedPerms = { ...perms, telegram_session_id: result.conversation_id };
        await this.prisma.teamSlot.update({
          where: { id: slot.id },
          data: { permissions: updatedPerms },
        });
      }

      await this.sendMessage(chatId, result.response);
    } catch {
      await this.sendMessage(chatId, '❌ Error procesando tu mensaje. Intenta de nuevo en un momento.');
    }
  }

  // ─── Configurar webhook con Telegram ─────────────────────────────────────

  async setupWebhook(publicUrl: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN no configurado' };

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${publicUrl}/telegram/webhook` }),
    });
    return res.json();
  }

  // ─── Telegram API helpers ─────────────────────────────────────────────────

  private async sendMessage(chatId: string, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    }).catch(() => {});
  }

  private async sendChatAction(chatId: string, action: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    }).catch(() => {});
  }
}
