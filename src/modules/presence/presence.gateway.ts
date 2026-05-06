import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PresenceService } from './presence.service';
import { PrismaService } from '../../database/prisma.service';

@WebSocketGateway({
  namespace: '/campus',
  cors: { origin: '*', credentials: true },
})
export class PresenceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private presenceService: PresenceService,
    private prisma: PrismaService,
  ) {}

  // ─── Conexión ──────────────────────────────────────────────────────────────

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth as any)?.token ??
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) return client.disconnect();

    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      }) as any;

      client.data.user = payload;
      client.data.slotId = payload.slot_id;
      client.data.tenantId = payload.tenant_id;

      // Unirse al campus del tenant
      client.join(`campus:${payload.tenant_id}`);

      // Unirse a sala personal para DMs
      client.join(`slot:${payload.slot_id}`);

      // Registrar jugador en memoria
      const playerState = await this.presenceService.playerJoined(
        payload.tenant_id,
        client.id,
        payload.slot_id,
      );

      // Enviar estado actual del campus solo a quien se conecta
      const campusState = this.presenceService.getCampusState(payload.tenant_id);
      client.emit('campus:state', campusState);

      // Notificar a todos los demás que alguien entró
      client.to(`campus:${payload.tenant_id}`).emit('player:joined', playerState);
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const { slotId, tenantId } = client.data ?? {};
    if (!slotId || !tenantId) return;

    await this.presenceService.playerLeft(tenantId, slotId);
    this.server.to(`campus:${tenantId}`).emit('player:left', { slot_id: slotId });
  }

  // ─── Movimiento ─────────────────────────────────────────────────────────────

  @SubscribeMessage('player:move')
  handleMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { x: number; y: number; direction: string; animation: string },
  ) {
    const { slotId, tenantId } = client.data;

    const updated = this.presenceService.updatePosition(
      tenantId, slotId, data.x, data.y, data.direction, data.animation,
    );
    if (!updated) return;

    // Broadcast a todos en el campus excepto quien envió
    client.to(`campus:${tenantId}`).emit('player:moved', {
      slot_id: slotId,
      x: data.x,
      y: data.y,
      direction: data.direction,
      animation: data.animation,
    });
  }

  // ─── Entrar / salir de sala ─────────────────────────────────────────────────

  @SubscribeMessage('player:enter_room')
  handleEnterRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room_id: string },
  ) {
    const { slotId, tenantId } = client.data;
    const prevRoom = this.presenceService.playerEnterRoom(tenantId, slotId, data.room_id);

    // Salir del socket.io room anterior
    if (prevRoom) {
      client.leave(`room:${prevRoom}`);
      this.server
        .to(`campus:${tenantId}`)
        .emit('player:exited_room', { slot_id: slotId, room_id: prevRoom });
    }

    // Unirse al nuevo socket.io room (canal de departamento)
    client.join(`room:${data.room_id}`);
    this.server
      .to(`campus:${tenantId}`)
      .emit('player:entered_room', { slot_id: slotId, room_id: data.room_id });

    // Enviar quién ya está en esa sala
    const playersInRoom = this.presenceService.getPlayersInRoom(tenantId, data.room_id);
    client.emit('room:members', { room_id: data.room_id, members: playersInRoom });
  }

  @SubscribeMessage('player:exit_room')
  handleExitRoom(@ConnectedSocket() client: Socket) {
    const { slotId, tenantId } = client.data;
    const prevRoom = this.presenceService.playerEnterRoom(tenantId, slotId, null as any);
    if (prevRoom) {
      client.leave(`room:${prevRoom}`);
      this.server
        .to(`campus:${tenantId}`)
        .emit('player:exited_room', { slot_id: slotId, room_id: prevRoom });
    }
  }

  // ─── Estado del avatar ──────────────────────────────────────────────────────

  @SubscribeMessage('player:status')
  async handleStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { status: 'ONLINE' | 'BUSY' | 'AWAY' },
  ) {
    const { slotId, tenantId } = client.data;
    this.presenceService.updateStatus(tenantId, slotId, data.status);

    await this.prisma.teamSlot.update({
      where: { id: slotId },
      data: { status: data.status },
    });

    this.server.to(`campus:${tenantId}`).emit('player:status_changed', {
      slot_id: slotId,
      status: data.status,
    });
  }

  // ─── Interacción con prop ───────────────────────────────────────────────────

  @SubscribeMessage('prop:interact')
  handlePropInteract(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { prop_id: string; action_type: string; action_target: string },
  ) {
    const { slotId, tenantId } = client.data;

    // El cliente maneja la navegación localmente para acciones como open_tool.
    // Para acciones multiusuario (start_meeting), notificar al campus.
    if (data.action_type === 'start_meeting') {
      this.server.to(`campus:${tenantId}`).emit('meeting:started', {
        initiator_slot_id: slotId,
        room_id: data.action_target,
      });
    }

    // Confirmar al iniciador que el evento fue procesado
    client.emit('prop:interacted', data);
  }

  // ─── Helpers públicos para otros gateways ─────────────────────────────────

  emitToTenant(tenantId: string, event: string, data: any) {
    this.server.to(`campus:${tenantId}`).emit(event, data);
  }

  emitToSlot(slotId: string, event: string, data: any) {
    this.server.to(`slot:${slotId}`).emit(event, data);
  }

  emitToRoom(roomId: string, event: string, data: any) {
    this.server.to(`room:${roomId}`).emit(event, data);
  }
}
