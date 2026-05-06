import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PresenceGateway } from '../presence/presence.gateway';

export interface CreateNotificationDto {
  slotId: string;
  tenantId: string;
  type: string;
  title: string;
  content: string;
  actionUrl?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private presence: PresenceGateway,
  ) {}

  async create(dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: {
        slot_id: dto.slotId,
        tenant_id: dto.tenantId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        action_url: dto.actionUrl,
      },
    });

    // Push en tiempo real si el slot está conectado al campus
    this.presence.emitToSlot(dto.slotId, 'notification:new', notification);

    return notification;
  }

  async findAll(slotId: string, onlyUnread = false) {
    const where = { slot_id: slotId, ...(onlyUnread ? { read: false } : {}) };

    const [notifications, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: 50,
      }),
      this.prisma.notification.count({ where: { slot_id: slotId, read: false } }),
    ]);

    return { notifications, unread };
  }

  async unreadCount(slotId: string) {
    const count = await this.prisma.notification.count({
      where: { slot_id: slotId, read: false },
    });
    return { count };
  }

  async markRead(id: string, slotId: string) {
    await this.prisma.notification.updateMany({
      where: { id, slot_id: slotId },
      data: { read: true },
    });
    return { ok: true };
  }

  async markAllRead(slotId: string) {
    await this.prisma.notification.updateMany({
      where: { slot_id: slotId, read: false },
      data: { read: true },
    });
    return { ok: true };
  }

  async remove(id: string, slotId: string) {
    await this.prisma.notification.deleteMany({ where: { id, slot_id: slotId } });
    return { ok: true };
  }
}
