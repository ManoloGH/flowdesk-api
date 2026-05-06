import { Controller, Get, Patch, Delete, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar notificaciones del usuario' })
  findAll(@Request() req: any, @Query('unread') unread?: string) {
    return this.notifications.findAll(req.user.slot_id, unread === 'true');
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Número de notificaciones no leídas (para polling)' })
  unreadCount(@Request() req: any) {
    return this.notifications.unreadCount(req.user.slot_id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marcar todas las notificaciones como leídas' })
  markAllRead(@Request() req: any) {
    return this.notifications.markAllRead(req.user.slot_id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar una notificación como leída' })
  markRead(@Param('id') id: string, @Request() req: any) {
    return this.notifications.markRead(id, req.user.slot_id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una notificación' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.notifications.remove(id, req.user.slot_id);
  }
}
