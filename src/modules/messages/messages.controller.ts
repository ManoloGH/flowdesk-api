import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/message.dto';

@ApiTags('Messages')
@ApiBearerAuth()
@Controller()
export class MessagesController {
  constructor(private service: MessagesService) {}

  @Post('messages')
  @ApiOperation({ summary: 'Enviar mensaje (DM, canal o anuncio)' })
  send(@Body() dto: SendMessageDto, @Request() req: any) {
    return this.service.send(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Get('messages/inbox')
  @ApiOperation({ summary: 'Bandeja de entrada — DMs no leídos' })
  inbox(@Request() req: any) {
    return this.service.getInbox(req.user.tenant_id, req.user.slot_id);
  }

  @Get('messages/dm/:otherSlotId')
  @ApiOperation({ summary: 'Historial de DM con otro empleado/agente' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  dmHistory(
    @Param('otherSlotId') otherId: string,
    @Query('page') page: string,
    @Request() req: any,
  ) {
    return this.service.getDmHistory(req.user.tenant_id, req.user.slot_id, otherId, parseInt(page ?? '1'));
  }

  @Get('messages/channel/:channelId')
  @ApiOperation({ summary: 'Historial de mensajes del canal de departamento' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  channelHistory(
    @Param('channelId') channelId: string,
    @Query('page') page: string,
    @Request() req: any,
  ) {
    return this.service.getChannelHistory(req.user.tenant_id, channelId, parseInt(page ?? '1'));
  }

  @Get('messages/announcements')
  @ApiOperation({ summary: 'Anuncios del tenant' })
  announcements(@Request() req: any) {
    return this.service.getAnnouncements(req.user.tenant_id);
  }

  @Patch('messages/read/:senderId')
  @ApiOperation({ summary: 'Marcar mensajes de un remitente como leídos' })
  markRead(@Param('senderId') senderId: string, @Request() req: any) {
    return this.service.markRead(req.user.tenant_id, req.user.slot_id, senderId);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Notificaciones del empleado' })
  getNotifications(@Request() req: any) {
    return this.service.getNotifications(req.user.tenant_id, req.user.slot_id);
  }

  @Patch('notifications/:notifId/read')
  @ApiOperation({ summary: 'Marcar notificación como leída' })
  markNotifRead(@Param('notifId') notifId: string, @Request() req: any) {
    return this.service.markNotifRead(req.user.tenant_id, req.user.slot_id, notifId);
  }
}
