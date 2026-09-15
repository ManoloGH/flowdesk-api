import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { DeliverableSkillsService } from './deliverable-skills.service';
import {
  CreateDeliverableSkillDto,
  UpdateDeliverableSkillDto,
  GenerateDocumentDto,
} from './dto/deliverable-skills.dto';

@UseGuards(JwtAuthGuard)
@Controller('deliverable-skills')
export class DeliverableSkillsController {
  constructor(private readonly service: DeliverableSkillsService) {}

  // ── Skills ────────────────────────────────────────────────────────

  @Get()
  list(@Request() req: any) {
    return this.service.listSkills(req.user.tenant_id);
  }

  @Get(':id')
  get(@Request() req: any, @Param('id') id: string) {
    return this.service.getSkill(req.user.tenant_id, id);
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreateDeliverableSkillDto) {
    return this.service.createSkill(req.user.tenant_id, dto);
  }

  @Patch(':id')
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateDeliverableSkillDto,
  ) {
    return this.service.updateSkill(req.user.tenant_id, id, dto);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.deleteSkill(req.user.tenant_id, id);
  }

  // ── Generación ────────────────────────────────────────────────────

  @Post(':id/generate')
  generate(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: GenerateDocumentDto,
  ) {
    return this.service.generate(req.user.tenant_id, id, req.user.id, dto);
  }

  // ── Historial ─────────────────────────────────────────────────────

  @Get(':id/generations')
  generations(@Request() req: any, @Param('id') id: string) {
    return this.service.listGenerations(req.user.tenant_id, id);
  }

  // ── Pública (sin auth) ────────────────────────────────────────────

  @Public()
  @Get('public/documento/:token')
  getByToken(@Param('token') token: string) {
    return this.service.getGenerationByToken(token);
  }
}
