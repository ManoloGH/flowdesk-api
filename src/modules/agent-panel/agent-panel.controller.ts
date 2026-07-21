import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Request,
  HttpCode,
} from '@nestjs/common';
import { AgentPanelService } from './agent-panel.service';
import {
  CreateSkillDto,
  UpdateSkillDto,
  CreateCorrectionDto,
  UpdateAgentConfigDto,
} from './dto/agent-panel.dto';

@Controller('agent-panel')
export class AgentPanelController {
  constructor(private readonly service: AgentPanelService) {}

  @Get('models')
  listModels(@Request() _req: any) {
    return this.service.listModels();
  }

  @Get(':id')
  getAgent(@Request() req: any, @Param('id') agentId: string) {
    return this.service.getAgent(req.user.tenant_id, agentId);
  }

  @Get(':id/dashboard')
  getDashboard(@Request() req: any, @Param('id') agentId: string) {
    return this.service.getDashboard(req.user.tenant_id, agentId);
  }

  @Get(':id/conversations')
  getConversations(
    @Request() req: any,
    @Param('id') agentId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getConversations(
      req.user.tenant_id,
      agentId,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
  }

  @Get(':id/corrections')
  getCorrections(
    @Request() req: any,
    @Param('id') agentId: string,
    @Query('source') source?: string,
  ) {
    return this.service.getCorrections(req.user.tenant_id, agentId, source);
  }

  @Post(':id/corrections')
  createCorrection(
    @Request() req: any,
    @Param('id') agentId: string,
    @Body() dto: CreateCorrectionDto,
  ) {
    return this.service.createCorrection(req.user.tenant_id, agentId, dto);
  }

  @Get(':id/skills')
  getSkills(@Request() req: any, @Param('id') agentId: string) {
    return this.service.getSkills(req.user.tenant_id, agentId);
  }

  @Post(':id/skills')
  createSkill(
    @Request() req: any,
    @Param('id') agentId: string,
    @Body() dto: CreateSkillDto,
  ) {
    return this.service.createSkill(req.user.tenant_id, agentId, dto);
  }

  @Put(':id/skills/:skillId')
  updateSkill(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('skillId') skillId: string,
    @Body() dto: UpdateSkillDto,
  ) {
    return this.service.updateSkill(req.user.tenant_id, agentId, skillId, dto);
  }

  @Delete(':id/skills/:skillId')
  @HttpCode(204)
  deleteSkill(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('skillId') skillId: string,
  ) {
    return this.service.deleteSkill(req.user.tenant_id, agentId, skillId);
  }

  @Get(':id/prospects')
  getProspects(
    @Request() req: any,
    @Param('id') agentId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getProspects(
      req.user.tenant_id,
      agentId,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
  }

  @Get(':id/calibrator')
  getCalibratorData(@Request() req: any, @Param('id') agentId: string) {
    return this.service.getCalibratorData(req.user.tenant_id, agentId);
  }

  @Post(':id/calibrate')
  triggerCalibration(@Request() req: any, @Param('id') agentId: string) {
    return this.service.triggerCalibration(req.user.tenant_id, agentId);
  }

  @Get(':id/evolution')
  getEvolutionStatus(@Request() req: any, @Param('id') agentId: string) {
    return this.service.getEvolutionStatus(req.user.tenant_id, agentId);
  }

  @Post(':id/evolution/trigger')
  triggerEvolution(@Request() req: any, @Param('id') agentId: string) {
    return this.service.triggerEvolution(req.user.tenant_id, agentId);
  }

  @Post(':id/evolution/:approvalId/approve')
  approveEvolution(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('approvalId') approvalId: string,
  ) {
    return this.service.approveEvolution(req.user.tenant_id, agentId, approvalId);
  }

  @Post(':id/evolution/:approvalId/reject')
  rejectEvolution(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('approvalId') approvalId: string,
  ) {
    return this.service.rejectEvolution(req.user.tenant_id, agentId, approvalId);
  }

  @Put(':id/config')
  updateConfig(
    @Request() req: any,
    @Param('id') agentId: string,
    @Body() dto: UpdateAgentConfigDto,
  ) {
    return this.service.updateConfig(req.user.tenant_id, agentId, dto);
  }

  @Get(':id/audit')
  getAuditLog(
    @Request() req: any,
    @Param('id') agentId: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getAuditLog(req.user.tenant_id, agentId, Number(limit ?? 50));
  }
}
