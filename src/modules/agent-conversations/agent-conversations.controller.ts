import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AgentConversationsService } from './agent-conversations.service';
import { ChatDto } from './dto/agent-conversations.dto';

@ApiTags('Agent Conversations')
@ApiBearerAuth()
@Controller('agents/:agentId/conversations')
export class AgentConversationsController {
  constructor(private service: AgentConversationsService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Enviar mensaje al agente y obtener respuesta con memoria' })
  chat(
    @Param('agentId') agentId: string,
    @Body() dto: ChatDto,
    @Request() req: any,
  ) {
    return this.service.chat(req.user.tenant_id, req.user.slot_id, agentId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar sesiones de conversación con este agente' })
  list(@Param('agentId') agentId: string, @Request() req: any) {
    return this.service.listConversations(req.user.tenant_id, req.user.slot_id, agentId);
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Ver historial de una conversación' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  getOne(
    @Param('agentId') agentId: string,
    @Param('conversationId') conversationId: string,
    @Query('page') page: string,
    @Request() req: any,
  ) {
    return this.service.getConversation(req.user.tenant_id, req.user.slot_id, conversationId, parseInt(page ?? '1'));
  }

  @Patch(':conversationId/end')
  @ApiOperation({ summary: 'Cerrar sesión de conversación' })
  end(
    @Param('agentId') agentId: string,
    @Param('conversationId') conversationId: string,
    @Request() req: any,
  ) {
    return this.service.endConversation(req.user.tenant_id, req.user.slot_id, conversationId);
  }
}
