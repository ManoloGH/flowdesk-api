import { Controller, Get, Post, Put, Body, Param, Request, UseGuards, HttpCode } from '@nestjs/common';
import { SalesService, CreateDealDto, MoveDealDto } from './sales.service';
import { SalesAgentService } from './sales-agent.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

class CloseDealDto { won: boolean; notes?: string; }
class AgentChatDto { message: string; }

@Controller('sales')
@UseGuards(JwtAuthGuard)
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly agent: SalesAgentService,
  ) {}

  @Get('summary')
  summary(@Request() req: any) {
    return this.sales.getSummary(req.user.tenant_id);
  }

  @Get('pipelines')
  pipelines(@Request() req: any) {
    return this.sales.getPipelines(req.user.tenant_id);
  }

  @Get('pipelines/:id')
  pipeline(@Request() req: any, @Param('id') id: string) {
    return this.sales.getPipelineWithDeals(req.user.tenant_id, id);
  }

  @Get('staled')
  staled(@Request() req: any) {
    return this.sales.getStaledDeals(req.user.tenant_id);
  }

  @Post('deals')
  @Roles('owner', 'admin', 'manager')
  createDeal(@Request() req: any, @Body() dto: CreateDealDto) {
    return this.sales.createDeal(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Put('deals/:id/move')
  @Roles('owner', 'admin', 'manager')
  moveDeal(@Request() req: any, @Param('id') id: string, @Body() dto: MoveDealDto) {
    return this.sales.moveDeal(req.user.tenant_id, id, dto);
  }

  @Put('deals/:id/close')
  @Roles('owner', 'admin', 'manager')
  closeDeal(@Request() req: any, @Param('id') id: string, @Body() dto: CloseDealDto) {
    return this.sales.closeDeal(req.user.tenant_id, id, dto.won, dto.notes);
  }

  @Post('agent/chat')
  @HttpCode(200)
  async agentChat(@Request() req: any, @Body() dto: AgentChatDto) {
    const reply = await this.agent.chat(req.user.tenant_id, req.user.slot_id, dto.message);
    return { reply };
  }
}
