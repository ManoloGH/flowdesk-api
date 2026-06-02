import { Controller, Get, Post, Put, Delete, Body, Param, Request, UseGuards, HttpCode } from '@nestjs/common';
import { SecretaryService, UpsertSecretaryConfigDto } from './secretary.service';
import { SecretaryAgentService } from './secretary-agent.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

class ChatDto {
  message: string;
}

class DecideDto {
  decision: 'approved' | 'rejected';
}

@Controller('secretary')
@UseGuards(JwtAuthGuard)
export class SecretaryController {
  constructor(
    private readonly secretary: SecretaryService,
    private readonly agent: SecretaryAgentService,
  ) {}

  // ── Config ────────────────────────────────────────────────────────────────

  @Get('config')
  getConfig(@Request() req: any) {
    return this.secretary.getConfig(req.user.tenant_id);
  }

  @Put('config')
  @Roles('owner', 'admin')
  upsertConfig(@Request() req: any, @Body() dto: UpsertSecretaryConfigDto) {
    return this.secretary.upsertConfig(req.user.tenant_id, dto);
  }

  // ── Chat con Atlas ────────────────────────────────────────────────────────

  @Post('chat')
  async chat(@Request() req: any, @Body() dto: ChatDto) {
    const reply = await this.agent.chat(req.user.tenant_id, dto.message, '');
    return { reply };
  }

  // ── Morning brief manual ──────────────────────────────────────────────────

  @Post('brief')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async brief(@Request() req: any) {
    await this.agent.sendMorningBrief(req.user.tenant_id);
    return { sent: true };
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  @Get('approvals')
  getApprovals(@Request() req: any) {
    return this.secretary.getPendingApprovals(req.user.tenant_id);
  }

  @Put('approvals/:id')
  @Roles('owner', 'admin')
  decide(@Request() req: any, @Param('id') id: string, @Body() dto: DecideDto) {
    return this.secretary.decide(req.user.tenant_id, id, dto.decision, req.user.slot_id);
  }

  // ── Work reports ──────────────────────────────────────────────────────────

  @Get('reports')
  getReports(@Request() req: any) {
    return this.secretary.getWorkReports(req.user.tenant_id);
  }

  // ── Delegation history ────────────────────────────────────────────────────

  @Get('delegations')
  getDelegations(@Request() req: any) {
    return this.secretary.getDelegationHistory(req.user.tenant_id);
  }
}
