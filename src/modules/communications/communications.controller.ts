import { Controller, Get, Put, Post, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CommunicationsService } from './communications.service';
import { BotConversationsService } from './bot-conversations.service';

@ApiTags('Communications')
@ApiBearerAuth()
@Controller('communications')
export class CommunicationsController {
  constructor(
    private service: CommunicationsService,
    private bot: BotConversationsService,
  ) {}

  @Get('channels')
  @ApiOperation({ summary: 'Estado de canales (WhatsApp + Teléfono) del tenant' })
  getChannels(@Request() req: any) {
    return this.service.getChannels(req.user.tenant_id);
  }

  @Get('contacts')
  @ApiOperation({ summary: 'Directorio: empleados (TeamSlot) + clientes/leads (Contact)' })
  getContacts(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('type') type?: string,
  ) {
    return this.service.getContacts(req.user.tenant_id, search, type);
  }

  @Get('routing')
  @ApiOperation({ summary: 'Configuración de ruteo: 3 slots con agentes conectados' })
  getRouting(@Request() req: any) {
    return this.service.getRouting(req.user.tenant_id);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Bandeja: conversaciones recientes del tenant' })
  getConversations(@Request() req: any) {
    return this.service.getConversations(req.user.tenant_id);
  }

  @Get('sales-agent')
  @ApiOperation({ summary: 'Configuración del Agente de Ventas del tenant' })
  getSalesAgentConfig(@Request() req: any) {
    return this.service.getSalesAgentConfig(req.user.tenant_id);
  }

  @Put('sales-agent')
  @ApiOperation({ summary: 'Actualiza la configuración del Agente de Ventas' })
  updateSalesAgentConfig(@Request() req: any, @Body() body: Record<string, any>) {
    return this.service.updateSalesAgentConfig(req.user.tenant_id, body);
  }

  // ─── Bot Conversations (Bandeja del Agente de Ventas) ─────────────────────

  @Get('bot/conversations')
  @ApiOperation({ summary: 'Lista conversaciones del Agente de Ventas' })
  getBotConversations(@Request() req: any) {
    return this.bot.getConversations(req.user.tenant_id);
  }

  @Get('bot/conversations/:id/messages')
  @ApiOperation({ summary: 'Mensajes de una conversación' })
  getBotMessages(@Request() req: any, @Param('id') id: string) {
    return this.bot.getMessages(req.user.tenant_id, id);
  }

  @Post('bot/conversations/:id/messages')
  @ApiOperation({ summary: 'Agente humano envía mensaje a la conversación' })
  sendBotMessage(@Request() req: any, @Param('id') id: string, @Body('content') content: string) {
    return this.bot.sendHumanMessage(req.user.tenant_id, id, content);
  }

  @Post('bot/conversations/:id/mode')
  @ApiOperation({ summary: 'Cambia modo AI/HUMAN de la conversación' })
  setBotMode(@Request() req: any, @Param('id') id: string, @Body('mode') mode: 'AI' | 'HUMAN') {
    return this.bot.setMode(req.user.tenant_id, id, mode);
  }

  @Delete('bot/conversations/:id')
  @ApiOperation({ summary: 'Elimina una conversación del bot' })
  deleteBotConversation(@Request() req: any, @Param('id') id: string) {
    return this.bot.deleteConversation(req.user.tenant_id, id);
  }
}
