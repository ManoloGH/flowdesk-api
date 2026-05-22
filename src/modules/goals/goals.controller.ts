import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { KsfService } from './services/ksf.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { RecognitionService } from './services/recognition.service';
import { GoalAlignmentService } from './services/goal-alignment.service';
import {
  CreateStrategicPurposeDto, CreateKsfRelationshipDto, CreateSuccessAreaDto,
  CreateKsfDto, UpdateKsfLevelsDto, CreateMilestoneDto, CompleteMilestoneDto,
  CreateEscalationConfigDto, SendRecognitionDto, SetReportsToDto,
} from './dto/goals.dto';
import { KsfLevel } from '@prisma/client';
import { startOfWeek, subDays, startOfMonth } from 'date-fns';

@Controller('goals')
export class GoalsController {
  constructor(
    private ksf: KsfService,
    private reports: ReportGeneratorService,
    private recognition: RecognitionService,
    private alignment: GoalAlignmentService,
  ) {}

  // ─── Setup AUP ────────────────────────────────────────────────────────────

  @Post('purpose')
  upsertPurpose(@Request() req: any, @Body() dto: CreateStrategicPurposeDto) {
    return this.ksf.upsertStrategicPurpose(req.user.tenant_id, dto);
  }

  @Get('purpose')
  getPurpose(@Request() req: any) {
    return this.ksf.getStrategicPurpose(req.user.tenant_id);
  }

  // ─── Relaciones (paso 1) ─────────────────────────────────────────────────

  @Post('relationships')
  createRelationship(@Request() req: any, @Body() dto: CreateKsfRelationshipDto) {
    return this.ksf.createRelationship(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Get('relationships')
  getRelationships(@Request() req: any) {
    return this.ksf.getRelationships(req.user.slot_id);
  }

  // ─── Áreas de éxito (paso 2) ─────────────────────────────────────────────

  @Post('success-areas')
  createSuccessArea(@Request() req: any, @Body() dto: CreateSuccessAreaDto) {
    return this.ksf.createSuccessArea(req.user.tenant_id, req.user.slot_id, dto);
  }

  // ─── KSFs (pasos 3 y 4) ──────────────────────────────────────────────────

  @Post('ksf')
  createKsf(@Request() req: any, @Body() dto: CreateKsfDto) {
    return this.ksf.createKsf(req.user.tenant_id, dto);
  }

  @Patch('ksf/:id/levels')
  updateLevels(@Request() req: any, @Param('id') ksfId: string, @Body() dto: UpdateKsfLevelsDto) {
    return this.ksf.updateKsfLevels(ksfId, req.user.tenant_id, dto);
  }

  @Get('ksf/mine')
  getMyKsfs(@Request() req: any) {
    return this.ksf.getKsfsForSlot(req.user.slot_id);
  }

  @Get('ksf/company')
  getCompanyKsfs(@Request() req: any) {
    return this.ksf.getKsfsForCompany(req.user.tenant_id);
  }

  @Get('ksf/slot/:slotId')
  getSlotKsfs(@Param('slotId') slotId: string) {
    return this.ksf.getKsfsForSlot(slotId);
  }

  // ─── Hitos ───────────────────────────────────────────────────────────────

  @Post('milestones')
  createMilestone(@Request() req: any, @Body() dto: CreateMilestoneDto) {
    return this.ksf.createMilestone(req.user.tenant_id, dto);
  }

  @Patch('milestones/:id/complete')
  completeMilestone(@Param('id') id: string, @Body() dto: CompleteMilestoneDto) {
    return this.ksf.completeMilestone(id, dto);
  }

  // ─── Escalación ──────────────────────────────────────────────────────────

  @Post('escalation-config')
  upsertEscalation(@Request() req: any, @Body() dto: CreateEscalationConfigDto) {
    return this.ksf.upsertEscalationConfig(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Get('escalation-config')
  getEscalation(@Request() req: any) {
    return this.ksf.getEscalationConfig(req.user.slot_id);
  }

  // ─── Jerarquía org ───────────────────────────────────────────────────────

  @Patch('org/reports-to')
  setReportsTo(@Request() req: any, @Body() dto: SetReportsToDto) {
    return this.ksf.setReportsTo(req.user.slot_id, dto.reports_to_id ?? null);
  }

  // ─── Informes ────────────────────────────────────────────────────────────

  @Get('reports/focus')
  getFocusReport(@Request() req: any, @Query('target_id') targetId?: string, @Query('level') level?: KsfLevel) {
    const resolvedTargetId = targetId ?? req.user.slot_id;
    const resolvedLevel    = level ?? KsfLevel.EMPLOYEE;
    const period           = startOfMonth(new Date());
    return this.reports.generateFocusReport(resolvedLevel, resolvedTargetId, period);
  }

  @Get('reports/feedback')
  getFeedbackReport(@Request() req: any, @Query('slot_id') slotId?: string) {
    const resolvedSlotId = slotId ?? req.user.slot_id;
    const weekStart      = startOfWeek(subDays(new Date(), 7), { weekStartsOn: 1 });
    return this.reports.generateFeedbackReport(resolvedSlotId, weekStart);
  }

  @Get('reports/management')
  getManagementReport(@Request() req: any) {
    const weekStart = startOfWeek(subDays(new Date(), 7), { weekStartsOn: 1 });
    return this.reports.generateManagementReport(req.user.slot_id, weekStart);
  }

  // ─── Reconocimientos ─────────────────────────────────────────────────────

  @Get('recognition/pending')
  getPendingRecognitions(@Request() req: any) {
    return this.recognition.getPendingRecognitions(req.user.tenant_id);
  }

  @Post('recognition/send')
  sendRecognition(@Request() req: any, @Body() dto: SendRecognitionDto) {
    const weekStart = startOfWeek(subDays(new Date(), 7), { weekStartsOn: 1 });
    return this.recognition.sendRecognition(req.user.tenant_id, req.user.slot_id, weekStart, dto);
  }

  @Get('recognition/history')
  getRecognitionHistory(@Request() req: any, @Query('slot_id') slotId?: string) {
    return this.recognition.getRecognitionHistory(req.user.tenant_id, slotId);
  }

  // ─── Health check de la organización ─────────────────────────────────────

  @Get('org/health')
  orgHealthCheck(@Request() req: any) {
    return this.alignment.runOrgHealthCheck(req.user.tenant_id);
  }

  @Get('org/setup-status')
  setupStatus(@Request() req: any) {
    return this.alignment.getSetupStatus(req.user.tenant_id);
  }

  @Get('org/chronic-problems')
  chronicProblems(@Request() req: any) {
    return this.alignment.getChronicProblems(req.user.tenant_id);
  }
}
