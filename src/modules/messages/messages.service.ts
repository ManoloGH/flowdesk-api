import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SendMessageDto } from './dto/message.dto';

const PAGE_SIZE = 40;

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

  async send(tenantId: string, senderId: string, dto: SendMessageDto) {
    const message = await this.prisma.message.create({
      data: {
        tenant_id: tenantId,
        sender_id: senderId,
        receiver_id: dto.receiver_id,
        channel_id: dto.channel_id,
        content: dto.content,
        type: (dto.type as any) ?? 'CHAT',
        metadata: dto.metadata,
      },
      include: {
        sender: { select: { id: true, name: true, avatar_url: true, avatar_config: true } },
        receiver: { select: { id: true, name: true, avatar_url: true } },
      },
    });

    // Crear notificación si es DM
    if (dto.receiver_id) {
      await this.prisma.notification.create({
        data: {
          slot_id: dto.receiver_id,
          tenant_id: tenantId,
          type: 'message',
          title: `Nuevo mensaje`,
          content: dto.content.slice(0, 80),
          action_url: `/messages/${senderId}`,
        },
      });
    }

    return message;
  }

  // Historial de DM entre dos slots
  async getDmHistory(tenantId: string, slotA: string, slotB: string, page = 1) {
    return this.prisma.message.findMany({
      where: {
        tenant_id: tenantId,
        type: 'CHAT',
        OR: [
          { sender_id: slotA, receiver_id: slotB },
          { sender_id: slotB, receiver_id: slotA },
        ],
      },
      include: {
        sender: { select: { id: true, name: true, avatar_url: true, avatar_config: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
  }

  // Mensajes de un canal de departamento
  async getChannelHistory(tenantId: string, channelId: string, page = 1) {
    return this.prisma.message.findMany({
      where: { tenant_id: tenantId, channel_id: channelId },
      include: {
        sender: { select: { id: true, name: true, avatar_url: true, avatar_config: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
  }

  // Bandeja de entrada: todos los DMs no leídos del slot
  async getInbox(tenantId: string, slotId: string) {
    const unreads = await this.prisma.message.groupBy({
      by: ['sender_id'],
      where: {
        tenant_id: tenantId,
        receiver_id: slotId,
        read_at: null,
        type: 'CHAT',
      },
      _count: { id: true },
    });

    const senderIds = unreads.map((u: any) => u.sender_id);
    const senders = await this.prisma.teamSlot.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, name: true, avatar_url: true, status: true },
    });

    return senders.map(s => ({
      ...s,
      unread_count: unreads.find((u: any) => u.sender_id === s.id)?._count?.id ?? 0,
    }));
  }

  async markRead(tenantId: string, slotId: string, senderId: string) {
    await this.prisma.message.updateMany({
      where: {
        tenant_id: tenantId,
        receiver_id: slotId,
        sender_id: senderId,
        read_at: null,
      },
      data: { read_at: new Date() },
    });
    return { ok: true };
  }

  // Announcements del tenant
  async getAnnouncements(tenantId: string) {
    return this.prisma.message.findMany({
      where: { tenant_id: tenantId, type: 'ANNOUNCEMENT' },
      include: {
        sender: { select: { id: true, name: true, avatar_url: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    });
  }

  // Notificaciones del slot
  async getNotifications(tenantId: string, slotId: string) {
    const notifs = await this.prisma.notification.findMany({
      where: { tenant_id: tenantId, slot_id: slotId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return notifs;
  }

  async markNotifRead(tenantId: string, slotId: string, notifId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notifId, tenant_id: tenantId, slot_id: slotId },
      data: { read: true },
    });
    return { ok: true };
  }
}
