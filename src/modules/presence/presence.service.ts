import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface PlayerState {
  slot_id: string;
  name: string;
  avatar_url: string | null;
  avatar_config: any;
  status: string;
  position_x: number;
  position_y: number;
  current_room_id: string | null;
  direction: string;
  socket_id: string;
}

@Injectable()
export class PresenceService {
  // Mapa en memoria: tenant_id → Map<slot_id, PlayerState>
  // Más rápido que DB para actualizaciones de posición frecuentes
  private campuses = new Map<string, Map<string, PlayerState>>();

  constructor(private prisma: PrismaService) {}

  async playerJoined(tenantId: string, socketId: string, slotId: string): Promise<PlayerState> {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: slotId, tenant_id: tenantId },
      select: {
        id: true, name: true, avatar_url: true, avatar_config: true,
        status: true, position_x: true, position_y: true,
      },
    });

    const state: PlayerState = {
      slot_id: slotId,
      name: slot?.name ?? 'Empleado',
      avatar_url: slot?.avatar_url ?? null,
      avatar_config: slot?.avatar_config ?? null,
      status: 'ONLINE',
      position_x: slot?.position_x ?? 100,
      position_y: slot?.position_y ?? 100,
      current_room_id: null,
      direction: 'down',
      socket_id: socketId,
    };

    if (!this.campuses.has(tenantId)) {
      this.campuses.set(tenantId, new Map());
    }
    this.campuses.get(tenantId)!.set(slotId, state);

    // Actualizar status en DB
    await this.prisma.teamSlot.update({
      where: { id: slotId },
      data: { status: 'ONLINE' },
    });

    return state;
  }

  async playerLeft(tenantId: string, slotId: string): Promise<void> {
    const campus = this.campuses.get(tenantId);
    if (campus) {
      const player = campus.get(slotId);
      if (player) {
        // Guardar última posición en DB antes de salir
        await this.prisma.teamSlot.update({
          where: { id: slotId },
          data: {
            status: 'OFFLINE',
            position_x: player.position_x,
            position_y: player.position_y,
          },
        });
      }
      campus.delete(slotId);
      if (campus.size === 0) this.campuses.delete(tenantId);
    }
  }

  updatePosition(
    tenantId: string,
    slotId: string,
    x: number,
    y: number,
    direction: string,
    animation: string,
  ): PlayerState | null {
    const player = this.campuses.get(tenantId)?.get(slotId);
    if (!player) return null;
    player.position_x = x;
    player.position_y = y;
    player.direction = direction;
    return player;
  }

  playerEnterRoom(tenantId: string, slotId: string, roomId: string): string | null {
    const player = this.campuses.get(tenantId)?.get(slotId);
    if (!player) return null;
    const prevRoom = player.current_room_id;
    player.current_room_id = roomId;
    return prevRoom;
  }

  updateStatus(tenantId: string, slotId: string, status: string): void {
    const player = this.campuses.get(tenantId)?.get(slotId);
    if (player) player.status = status;
  }

  getCampusState(tenantId: string): PlayerState[] {
    return Array.from(this.campuses.get(tenantId)?.values() ?? []);
  }

  getPlayersInRoom(tenantId: string, roomId: string): PlayerState[] {
    return this.getCampusState(tenantId).filter(p => p.current_room_id === roomId);
  }

  // Persistir posiciones al DB cada N segundos (llamado desde un cron o manualmente)
  async flushPositions(tenantId: string): Promise<void> {
    const campus = this.campuses.get(tenantId);
    if (!campus) return;
    await Promise.allSettled(
      Array.from(campus.values()).map(p =>
        this.prisma.teamSlot.update({
          where: { id: p.slot_id },
          data: { position_x: p.position_x, position_y: p.position_y },
        }),
      ),
    );
  }
}
