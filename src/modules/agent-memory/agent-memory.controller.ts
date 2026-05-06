import { Controller, Get, Post, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { AgentMemoryService } from './agent-memory.service';
import { CreateMemoryDto, QueryMemoriesDto } from './dto/agent-memory.dto';

@ApiTags('Agent Memory (Segundo Cerebro)')
@ApiBearerAuth()
@Controller('agents/:agentId/memory')
export class AgentMemoryController {
  constructor(private service: AgentMemoryService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas las memorias de un agente' })
  list(@Param('agentId') agentId: string, @Request() req: any) {
    return this.service.listByAgent(req.user.tenant_id, agentId);
  }

  @Post('query')
  @ApiOperation({ summary: 'Buscar memorias relevantes por consulta' })
  query(
    @Param('agentId') agentId: string,
    @Body() dto: QueryMemoriesDto,
    @Request() req: any,
  ) {
    return this.service.query(req.user.tenant_id, agentId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Agregar una memoria manualmente al agente' })
  store(
    @Param('agentId') agentId: string,
    @Body() dto: CreateMemoryDto,
    @Request() req: any,
  ) {
    return this.service.store(req.user.tenant_id, agentId, req.user.slot_id, dto);
  }

  @Delete(':memoryId')
  @Roles('admin', 'owner')
  @ApiOperation({ summary: 'Eliminar una memoria específica' })
  remove(
    @Param('agentId') agentId: string,
    @Param('memoryId') memoryId: string,
    @Request() req: any,
  ) {
    return this.service.delete(req.user.tenant_id, agentId, memoryId);
  }
}
