import { Controller, Get, Put, Post, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CultureEngineService } from './culture-engine.service';

@UseGuards(JwtAuthGuard)
@Controller('culture-engine')
export class CultureEngineController {
  constructor(private readonly engine: CultureEngineService) {}

  @Get()
  getFullEngine(@Req() req: any) {
    return this.engine.getFullCultureEngine(req.user.tenantId);
  }

  @Get('health')
  getHealth(@Req() req: any) {
    return this.engine.calculateHealthScore(req.user.tenantId);
  }

  // ── Layer 1 — Founder DNA ────────────────────────────────────────────────

  @Get('founder-dna')
  getFounderProfile(@Req() req: any) {
    return this.engine.getFounderProfile(req.user.tenantId);
  }

  @Put('founder-dna')
  upsertFounderProfile(@Req() req: any, @Body() body: {
    industry_change?: string;
    differentiator?: string;
    loved_behaviors?: string[];
    zero_tolerance?: string[];
    hated_inefficiencies?: string[];
    doing_well_means?: string;
    team_feeling?: string;
    client_energy?: string;
    ai_tasks?: string[];
    ai_never_replace?: string[];
    tone_description?: string;
    leadership_style?: string;
    operating_style?: string;
    key_obsessions?: string[];
    decision_principles?: string[];
    calibrate_now?: boolean;
  }) {
    return this.engine.upsertFounderProfile(req.user.tenantId, body);
  }

  @Post('founder-dna/calibrate')
  calibrateAtlas(@Req() req: any) {
    return this.engine.calibrateAtlasWithFounderDNA(req.user.tenantId);
  }

  // ── Layer 4 — Communication Voice ────────────────────────────────────────

  @Get('communication')
  getCommunicationProfile(@Req() req: any) {
    return this.engine.getCommunicationProfile(req.user.tenantId);
  }

  @Post('communication/samples')
  addSamples(@Req() req: any, @Body() body: { samples: { type: string; content: string; label?: string }[] }) {
    return this.engine.addCommunicationSamples(req.user.tenantId, body.samples);
  }

  @Post('communication/calibrate')
  calibrateVoice(@Req() req: any) {
    return this.engine.calibrateCommunicationVoice(req.user.tenantId);
  }

  // ── Layer 3 — Culture Blueprint ──────────────────────────────────────────

  @Get('blueprint')
  getBlueprint(@Req() req: any) {
    return this.engine.getCultureBlueprint(req.user.tenantId);
  }

  @Put('blueprint')
  upsertBlueprint(@Req() req: any, @Body() body: {
    philosophy_statements?: string[];
    operational_rules?: { trigger: string; expected_behavior: string; metric?: string; owner?: string }[];
    response_standards?: { channel: string; max_hours: number; note?: string }[];
    decision_frameworks?: { situation: string; principle: string; action: string }[];
    company_language?: { term: string; meaning: string; context?: string }[];
  }) {
    return this.engine.upsertCultureBlueprint(req.user.tenantId, body);
  }

  @Post('blueprint/translate')
  translatePhilosophy(@Req() req: any, @Body() body: { statements: string[] }) {
    return this.engine.translatePhilosophyToRules(req.user.tenantId, body.statements);
  }

  // ── Layer 2 — Operating Map ───────────────────────────────────────────────

  @Get('operating-map')
  getOperatingMap(@Req() req: any) {
    return this.engine.getOperatingMap(req.user.tenantId);
  }

  @Put('operating-map')
  upsertOperatingMap(@Req() req: any, @Body() body: {
    current_systems?: { name: string; category: string; used_for: string; status?: string }[];
    key_processes?: { name: string; owner_name: string; steps: string[]; friction: string[]; ai_potential?: string }[];
    pain_points?: { area: string; description: string; impact: string }[];
  }) {
    return this.engine.upsertOperatingMap(req.user.tenantId, body);
  }
}
