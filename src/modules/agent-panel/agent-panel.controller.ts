import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';

function safeInt(val: string | undefined, fallback: number, max = Infinity): number {
  const n = parseInt(val ?? '', 10);
  return Math.min(max, isNaN(n) || n < 1 ? fallback : n);
}
import { AgentPanelService } from './agent-panel.service';
import {
  CreateSkillDto,
  UpdateSkillDto,
  CreateCorrectionDto,
  UpdateAgentConfigDto,
  TestMessageDto,
  CreateCaseDto,
  UpdateCaseDto,
  CreateClassificationDto,
  CreateDeliverableDto,
  UpdateDeliverableDto,
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
      safeInt(page, 1),
      safeInt(limit, 20, 100),
    );
  }

  @Get(':id/conversations/:convId/messages')
  getConversationMessages(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('convId') convId: string,
  ) {
    return this.service.getConversationMessages(req.user.tenant_id, agentId, convId);
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
      safeInt(page, 1),
      safeInt(limit, 20, 100),
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

  @Post(':id/test-message')
  testMessage(
    @Request() req: any,
    @Param('id') agentId: string,
    @Body() dto: TestMessageDto,
  ) {
    return this.service.testMessage(req.user.tenant_id, agentId, dto);
  }

  @Get(':id/audit')
  getAuditLog(
    @Request() req: any,
    @Param('id') agentId: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getAuditLog(req.user.tenant_id, agentId, safeInt(limit, 50, 200));
  }

  // ── Catálogo de casos ──────────────────────────────────────────────────────

  @Get(':id/cases')
  getCases(
    @Request() req: any,
    @Param('id') agentId: string,
    @Query('search') search?: string,
  ) {
    return this.service.getCases(req.user.tenant_id, agentId, search);
  }

  @Post(':id/cases')
  createCase(@Request() req: any, @Param('id') agentId: string, @Body() dto: CreateCaseDto) {
    return this.service.createCase(req.user.tenant_id, agentId, dto);
  }

  @Patch(':id/cases/:caseId')
  updateCase(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('caseId') caseId: string,
    @Body() dto: UpdateCaseDto,
  ) {
    return this.service.updateCase(req.user.tenant_id, agentId, caseId, dto);
  }

  @Delete(':id/cases/:caseId')
  deleteCase(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('caseId') caseId: string,
  ) {
    return this.service.deleteCase(req.user.tenant_id, agentId, caseId);
  }

  @Post(':id/cases/search')
  searchCase(
    @Request() req: any,
    @Param('id') agentId: string,
    @Body('query') query: string,
  ) {
    return this.service.searchCase(req.user.tenant_id, agentId, query);
  }

  // ── Clasificaciones ────────────────────────────────────────────────────────

  @Get(':id/classifications')
  getClassifications(
    @Request() req: any,
    @Param('id') agentId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('source') source?: string,
    @Query('resolution') resolution?: string,
    @Query('feedback') feedback?: string,
  ) {
    return this.service.getClassifications(
      req.user.tenant_id,
      agentId,
      safeInt(page, 1),
      safeInt(limit, 20, 100),
      source,
      resolution,
      feedback,
    );
  }

  @Post(':id/classifications')
  createClassification(
    @Request() req: any,
    @Param('id') agentId: string,
    @Body() dto: CreateClassificationDto,
  ) {
    return this.service.createClassification(req.user.tenant_id, agentId, dto);
  }

  @Patch(':id/classifications/:classId/feedback')
  updateClassificationFeedback(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('classId') classId: string,
    @Body('feedback') feedback: string,
  ) {
    return this.service.updateClassificationFeedback(req.user.tenant_id, agentId, classId, feedback);
  }

  // ── Entregables ────────────────────────────────────────────────────────────

  @Get(':id/deliverables')
  getDeliverables(@Request() req: any, @Param('id') agentId: string) {
    return this.service.getDeliverables(req.user.tenant_id, agentId);
  }

  @Post(':id/deliverables')
  createDeliverable(
    @Request() req: any,
    @Param('id') agentId: string,
    @Body() dto: CreateDeliverableDto,
  ) {
    return this.service.createDeliverable(req.user.tenant_id, agentId, dto);
  }

  @Patch(':id/deliverables/:deliverableId')
  updateDeliverable(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('deliverableId') deliverableId: string,
    @Body() dto: UpdateDeliverableDto,
  ) {
    return this.service.updateDeliverable(req.user.tenant_id, agentId, deliverableId, dto);
  }

  @Delete(':id/deliverables/:deliverableId')
  deleteDeliverable(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('deliverableId') deliverableId: string,
  ) {
    return this.service.deleteDeliverable(req.user.tenant_id, agentId, deliverableId);
  }

  @Get(':id/deliverables/:deliverableId/responses')
  getDeliverableResponses(
    @Request() req: any,
    @Param('id') agentId: string,
    @Param('deliverableId') deliverableId: string,
  ) {
    return this.service.getDeliverableResponses(req.user.tenant_id, agentId, deliverableId);
  }

  @Public()
  @Get('public/deliverable/:token')
  getPublicDeliverable(@Param('token') token: string) {
    return this.service.getDeliverableResponseByToken(token);
  }
}
