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
import { MessagesService } from './messages.service';

@WebSocketGateway({
  namespace: '/messages',
  cors: { origin: '*', credentials: true },
})
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private messagesService: MessagesService,
  ) {}

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
      client.join(`tenant:${payload.tenant_id}`);
      client.join(`slot:${payload.slot_id}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(_client: Socket) {}

  // ─── Enviar mensaje DM en tiempo real ─────────────────────────────────────

  @SubscribeMessage('message:send')
  async handleSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { content: string; receiver_id?: string; channel_id?: string; type?: string; metadata?: any },
  ) {
    const { slot_id, tenant_id } = client.data.user;

    const message = await this.messagesService.send(tenant_id, slot_id, {
      content: data.content,
      receiver_id: data.receiver_id,
      channel_id: data.channel_id,
      type: data.type,
      metadata: data.metadata,
    });

    // Confirmar al remitente
    client.emit('message:sent', message);

    // Entregar al destinatario si es DM
    if (data.receiver_id) {
      this.server.to(`slot:${data.receiver_id}`).emit('message:received', message);
    }

    // Entregar al canal de departamento
    if (data.channel_id) {
      client.to(`channel:${data.channel_id}`).emit('message:channel', message);
    }

    return message;
  }

  // ─── Unirse al canal de un departamento ───────────────────────────────────

  @SubscribeMessage('channel:join')
  handleJoinChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channel_id: string },
  ) {
    client.join(`channel:${data.channel_id}`);
    client.emit('channel:joined', { channel_id: data.channel_id });
  }

  // ─── Typing indicator ─────────────────────────────────────────────────────

  @SubscribeMessage('message:typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiver_id?: string; channel_id?: string; typing: boolean },
  ) {
    const { slot_id } = client.data.user;
    const payload = { slot_id, typing: data.typing };

    if (data.receiver_id) {
      client.to(`slot:${data.receiver_id}`).emit('message:typing', payload);
    }
    if (data.channel_id) {
      client.to(`channel:${data.channel_id}`).emit('message:typing', payload);
    }
  }

  // ─── Helpers para otros servicios ─────────────────────────────────────────

  deliverToSlot(slotId: string, event: string, data: any) {
    this.server.to(`slot:${slotId}`).emit(event, data);
  }

  deliverToTenant(tenantId: string, event: string, data: any) {
    this.server.to(`tenant:${tenantId}`).emit(event, data);
  }

  deliverToChannel(channelId: string, event: string, data: any) {
    this.server.to(`channel:${channelId}`).emit(event, data);
  }
}
