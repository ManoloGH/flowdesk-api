import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Req,
} from '@nestjs/common';
import { SenseiService } from './sensei.service';
import {
  CreateSenseiProjectDto, UpdateSenseiProjectDto,
  AddEvidenceDto, SendMessageDto, RunIterationDto,
  IterationFeedbackDto, CertifySkillDto,
} from './dto/sensei.dto';

@Controller('sensei')
export class SenseiController {
  constructor(private readonly sensei: SenseiService) {}

  // ── Proyectos ──────────────────────────────────────────────────────
  @Get()
  list(@Req() req: any) {
    return this.sensei.listProjects(req.user.tenant_id);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.sensei.getProject(req.user.tenant_id, id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateSenseiProjectDto) {
    return this.sensei.createProject(req.user.tenant_id, req.user.sub, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateSenseiProjectDto) {
    return this.sensei.updateProject(req.user.tenant_id, id, dto);
  }

  // ── Evidencia ──────────────────────────────────────────────────────
  @Post(':id/evidence')
  addEvidence(@Req() req: any, @Param('id') id: string, @Body() dto: AddEvidenceDto) {
    return this.sensei.addEvidence(req.user.tenant_id, id, dto);
  }

  @Delete(':id/evidence/:evidenceId')
  deleteEvidence(@Req() req: any, @Param('id') id: string, @Param('evidenceId') evidenceId: string) {
    return this.sensei.deleteEvidence(req.user.tenant_id, id, evidenceId);
  }

  // ── Chat ───────────────────────────────────────────────────────────
  @Post(':id/message')
  sendMessage(@Req() req: any, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.sensei.sendMessage(req.user.tenant_id, id, dto);
  }

  // ── Fase manual ───────────────────────────────────────────────────
  @Post(':id/advance')
  advance(@Req() req: any, @Param('id') id: string, @Body() body: { phase: string }) {
    return this.sensei.advancePhase(req.user.tenant_id, id, body.phase);
  }

  // ── Iteraciones ───────────────────────────────────────────────────
  @Post(':id/iterate')
  iterate(@Req() req: any, @Param('id') id: string, @Body() dto: RunIterationDto) {
    return this.sensei.runIteration(req.user.tenant_id, id, dto);
  }

  @Patch(':id/iterations/:iterationId/feedback')
  feedback(
    @Req() req: any,
    @Param('id') id: string,
    @Param('iterationId') iterationId: string,
    @Body() dto: IterationFeedbackDto,
  ) {
    return this.sensei.submitFeedback(req.user.tenant_id, id, iterationId, dto);
  }

  // ── Certificación ─────────────────────────────────────────────────
  @Post(':id/certify')
  certify(@Req() req: any, @Param('id') id: string, @Body() dto: CertifySkillDto) {
    return this.sensei.certify(req.user.tenant_id, id, dto);
  }
}
