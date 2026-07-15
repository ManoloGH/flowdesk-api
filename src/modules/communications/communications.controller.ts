import { Controller, Get, Put, Body, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CommunicationsService } from './communications.service';

@ApiTags('Communications')
@ApiBearerAuth()
@Controller('communications')
export class CommunicationsController {
  constructor(private service: CommunicationsService) {}

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
}
