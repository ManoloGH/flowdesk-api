import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';

const CULTURE_MODEL = 'claude-sonnet-4-6';

@Injectable()
export class CultureEngineService {
  private readonly anthropic: Anthropic;

  constructor(private prisma: PrismaService) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // ── Layer 1 — Founder DNA ────────────────────────────────────────────────────

  async upsertFounderProfile(tenantId: string, input: {
    slot_id?: string;
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
    calibrate_now?: boolean;
  }) {
    const data: any = {};
    if (input.industry_change !== undefined)    data.industry_change    = input.industry_change;
    if (input.differentiator !== undefined)     data.differentiator     = input.differentiator;
    if (input.loved_behaviors !== undefined)    data.loved_behaviors    = input.loved_behaviors;
    if (input.zero_tolerance !== undefined)     data.zero_tolerance     = input.zero_tolerance;
    if (input.hated_inefficiencies !== undefined) data.hated_inefficiencies = input.hated_inefficiencies;
    if (input.doing_well_means !== undefined)   data.doing_well_means   = input.doing_well_means;
    if (input.team_feeling !== undefined)       data.team_feeling       = input.team_feeling;
    if (input.client_energy !== undefined)      data.client_energy      = input.client_energy;
    if (input.ai_tasks !== undefined)           data.ai_tasks           = input.ai_tasks;
    if (input.ai_never_replace !== undefined)   data.ai_never_replace   = input.ai_never_replace;

    // Obtener owner slot_id si no viene
    let slotId = input.slot_id;
    if (!slotId) {
      const owner = await this.prisma.teamSlot.findFirst({
        where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
        select: { id: true },
      });
      slotId = owner?.id ?? '';
    }

    const profile = await this.prisma.founderProfile.upsert({
      where:  { tenant_id: tenantId },
      create: { tenant_id: tenantId, slot_id: slotId, ...data },
      update: data,
    });

    // Calibrar Atlas inmediatamente si se pide y hay suficiente info
    if (input.calibrate_now) {
      await this.calibrateAtlasWithFounderDNA(tenantId);
    }

    return profile;
  }

  async getFounderProfile(tenantId: string) {
    return this.prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } });
  }

  // ── Calibración de Atlas con Founder DNA ─────────────────────────────────────

  async calibrateAtlasWithFounderDNA(tenantId: string): Promise<{ calibrated: boolean; summary?: string }> {
    const [profile, tenant, owner] = await Promise.all([
      this.prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.teamSlot.findFirst({
        where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
        select: { id: true, name: true },
      }),
    ]);

    if (!profile || !owner) return { calibrated: false };

    // Generar instrucciones personalizadas con Claude
    const prompt = `Eres un experto en diseño de agentes IA corporativos.
Tu tarea es generar las instrucciones del sistema para un CEO Agent (Atlas) ultra-personalizado para un fundador específico.
El agente debe sonar y pensar EXACTAMENTE como ese fundador se lo imagina.

INFORMACIÓN DEL FUNDADOR:
Empresa: ${tenant?.name ?? 'N/A'}
Fundador: ${owner.name}

LO QUE QUIERE CAMBIAR EN SU INDUSTRIA: ${profile.industry_change ?? 'N/A'}
LO QUE HACE DIFERENTE A SU EMPRESA: ${profile.differentiator ?? 'N/A'}
QUÉ SIGNIFICA "HACERLO BIEN": ${profile.doing_well_means ?? 'N/A'}
ENERGÍA QUE TRANSMITE AL CLIENTE: ${profile.client_energy ?? 'N/A'}
CÓMO QUIERE QUE SE SIENTA EL EQUIPO: ${profile.team_feeling ?? 'N/A'}

COMPORTAMIENTOS QUE AMA: ${JSON.stringify(profile.loved_behaviors ?? [])}
LO QUE JAMÁS TOLERARÍA: ${JSON.stringify(profile.zero_tolerance ?? [])}
LO QUE MÁS LE DESESPERA: ${JSON.stringify(profile.hated_inefficiencies ?? [])}

IA DEBE HACER: ${JSON.stringify(profile.ai_tasks ?? [])}
IA JAMÁS REEMPLAZA: ${JSON.stringify(profile.ai_never_replace ?? [])}

Genera las instrucciones del sistema para Atlas. Deben:
1. Comenzar con la identidad del agente y su misión con este fundador específico
2. Incorporar su filosofía operativa y estilo como guía de comportamiento del agente
3. Incluir qué comportamientos debe reforzar y cuáles debe señalar cuando los detecte
4. Definir el tono y energía de sus respuestas alineado con la cultura deseada
5. Especificar cómo debe manejar la relación humano-IA según los valores del fundador
6. Ser directo, ejecutivo y completamente personalizado — no genérico

Genera solo las instrucciones del sistema, sin explicaciones adicionales. En español.
Máximo 600 palabras.`;

    const apiResponse = await this.anthropic.messages.create({
      model: CULTURE_MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    const instructions = apiResponse.content[0]?.type === 'text' ? apiResponse.content[0].text : null;
    if (!instructions) return { calibrated: false };

    // Guardar instrucciones en el perfil
    await this.prisma.founderProfile.update({
      where: { tenant_id: tenantId },
      data: { atlas_instructions: instructions, atlas_calibrated_at: new Date() },
    });

    // Actualizar el CEO Agent del owner con las nuevas instrucciones
    const atlasAgent = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, owner_slot_id: owner.id, agent_role: 'ceo', type: 'AI_AGENT' },
    });

    if (atlasAgent) {
      const currentConfig = (atlasAgent.agent_config as any) ?? {};
      await this.prisma.teamSlot.update({
        where: { id: atlasAgent.id },
        data: { agent_config: { ...currentConfig, instructions } },
      });
    }

    return { calibrated: true, summary: `Atlas calibrado con ${Object.keys(profile).filter(k => profile[k as keyof typeof profile]).length} elementos del perfil del fundador.` };
  }

  // ── Layer 4 — Communication Mirroring ───────────────────────────────────────

  async addCommunicationSamples(tenantId: string, newSamples: { type: string; content: string; label?: string }[]) {
    const existing = await this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } });
    const currentSamples: any[] = (existing?.samples as any[]) ?? [];
    const merged = [...currentSamples, ...newSamples];

    const quality = merged.length >= 10 ? 'high' : merged.length >= 5 ? 'medium' : merged.length >= 2 ? 'low' : 'none';

    return this.prisma.communicationProfile.upsert({
      where: { tenant_id: tenantId },
      create: { tenant_id: tenantId, samples: merged, samples_count: merged.length, calibration_quality: quality },
      update: { samples: merged, samples_count: merged.length, calibration_quality: quality },
    });
  }

  async calibrateCommunicationVoice(tenantId: string): Promise<{ calibrated: boolean; voice_summary?: string }> {
    const profile = await this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } });
    if (!profile || !(profile.samples as any[])?.length) return { calibrated: false };

    const samples = profile.samples as any[];
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, industry: true } });

    const prompt = `Analiza los siguientes ejemplos de comunicación de la empresa "${tenant?.name}" (sector: ${tenant?.industry ?? 'no especificado'}).

MUESTRAS:
${samples.map((s: any, i: number) => `
[${i + 1}] TIPO: ${s.type}${s.label ? ` — ${s.label}` : ''}
${s.content}
---`).join('\n')}

Extrae el perfil de comunicación de esta empresa. Responde en JSON con esta estructura exacta:
{
  "tone": "formal|semiformal|casual|cálido|directo",
  "energy": "alto|medio|bajo",
  "formality": "alta|media|baja",
  "structure": "bullets|párrafos|conversacional|mixto",
  "avg_length": "breve|medio|extenso",
  "key_phrases": ["frases que usan frecuentemente"],
  "avoid_phrases": ["frases que claramente evitan"],
  "custom_vocab": [{"original": "término genérico", "preferred": "cómo lo dicen ellos"}],
  "voice_summary": "Párrafo de 2-3 oraciones que describe el estilo de comunicación de esta empresa para que un agente IA pueda adoptarlo",
  "patterns": {
    "opening_style": "cómo empiezan mensajes",
    "closing_style": "cómo cierran mensajes",
    "persuasion_style": "cómo convencen",
    "problem_handling": "cómo manejan problemas o quejas"
  }
}

Responde SOLO el JSON, sin texto adicional.`;

    const apiResponse = await this.anthropic.messages.create({
      model: CULTURE_MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = apiResponse.content[0]?.type === 'text' ? apiResponse.content[0].text.trim() : null;
    if (!text) return { calibrated: false };

    try {
      const parsed = JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, ''));

      await this.prisma.communicationProfile.update({
        where: { tenant_id: tenantId },
        data: {
          tone:               parsed.tone,
          energy:             parsed.energy,
          formality:          parsed.formality,
          structure:          parsed.structure,
          avg_length:         parsed.avg_length,
          key_phrases:        parsed.key_phrases,
          avoid_phrases:      parsed.avoid_phrases,
          custom_vocab:       parsed.custom_vocab,
          voice_summary:      parsed.voice_summary,
          extracted_patterns: parsed.patterns,
          last_calibrated_at: new Date(),
          calibration_quality: (profile.samples as any[]).length >= 10 ? 'high' : 'medium',
        },
      });

      return { calibrated: true, voice_summary: parsed.voice_summary };
    } catch {
      return { calibrated: false };
    }
  }

  async getCommunicationProfile(tenantId: string) {
    return this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } });
  }

  // ── Layer 3 — Culture Blueprint ──────────────────────────────────────────────

  async upsertCultureBlueprint(tenantId: string, input: {
    philosophy_statements?: string[];
    operational_rules?: { trigger: string; expected_behavior: string; metric?: string; owner?: string }[];
    response_standards?: { channel: string; max_hours: number; note?: string }[];
    decision_frameworks?: { situation: string; principle: string; action: string }[];
    company_language?: { term: string; meaning: string; context?: string }[];
  }) {
    const data: any = {};
    if (input.philosophy_statements !== undefined) data.philosophy_statements = input.philosophy_statements;
    if (input.operational_rules !== undefined)     data.operational_rules     = input.operational_rules;
    if (input.response_standards !== undefined)    data.response_standards    = input.response_standards;
    if (input.decision_frameworks !== undefined)   data.decision_frameworks   = input.decision_frameworks;
    if (input.company_language !== undefined)      data.company_language      = input.company_language;

    return this.prisma.cultureBlueprint.upsert({
      where:  { tenant_id: tenantId },
      create: { tenant_id: tenantId, ...data },
      update: data,
    });
  }

  async translatePhilosophyToRules(tenantId: string, statements: string[]): Promise<any> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, industry: true } });

    const prompt = `Eres un experto en diseño organizacional y cultura operativa.
La empresa "${tenant?.name}" (sector: ${tenant?.industry ?? 'general'}) tiene estas declaraciones de filosofía:

${statements.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

Traduce cada declaración en reglas operativas concretas y medibles. Para cada una genera:
- trigger: cuándo aplica esta regla (situación específica)
- expected_behavior: qué hace exactamente la persona (acción observable)
- metric: cómo se mide (si aplica)
- owner: quién es responsable de que se cumpla

También genera:
- response_standards: tiempos máximos de respuesta por canal (WhatsApp, email, interno)
- decision_frameworks: si X situación, entonces aplicar Y principio y hacer Z

Responde en JSON:
{
  "operational_rules": [{"trigger": "...", "expected_behavior": "...", "metric": "...", "owner": "..."}],
  "response_standards": [{"channel": "...", "max_hours": 0, "note": "..."}],
  "decision_frameworks": [{"situation": "...", "principle": "...", "action": "..."}]
}

Solo el JSON.`;

    const apiResponse = await this.anthropic.messages.create({
      model: CULTURE_MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = apiResponse.content[0]?.type === 'text' ? apiResponse.content[0].text.trim() : '{}';
    try {
      return JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, ''));
    } catch {
      return { error: 'No se pudo parsear la respuesta' };
    }
  }

  async getCultureBlueprint(tenantId: string) {
    return this.prisma.cultureBlueprint.findUnique({ where: { tenant_id: tenantId } });
  }

  // ── Layer 2 — Operating Map ──────────────────────────────────────────────────

  async upsertOperatingMap(tenantId: string, input: {
    current_systems?: { name: string; category: string; used_for: string; status?: string }[];
    key_processes?: { name: string; owner_name: string; steps: string[]; friction: string[]; ai_potential?: string }[];
    pain_points?: { area: string; description: string; impact: string }[];
  }) {
    const data: any = {};
    if (input.current_systems !== undefined) data.current_systems = input.current_systems;
    if (input.key_processes !== undefined)   data.key_processes   = input.key_processes;
    if (input.pain_points !== undefined)     data.pain_points     = input.pain_points;

    return this.prisma.operatingMap.upsert({
      where:  { tenant_id: tenantId },
      create: { tenant_id: tenantId, ...data },
      update: data,
    });
  }

  async getOperatingMap(tenantId: string) {
    return this.prisma.operatingMap.findUnique({ where: { tenant_id: tenantId } });
  }

  // ── Health Score del Culture Engine ──────────────────────────────────────────

  async calculateHealthScore(tenantId: string) {
    const [founder, commProfile, blueprint, operatingMap, cultureConfig, ksfs, agents, slots] = await Promise.all([
      this.prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.cultureBlueprint.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.operatingMap.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.cultureConfig.findUnique({ where: { tenant_id: tenantId }, include: { principles: true, rituals: true } }),
      this.prisma.keySuccessFactor.count({ where: { tenant_id: tenantId, is_active: true } }),
      this.prisma.teamSlot.count({ where: { tenant_id: tenantId, type: 'AI_AGENT' } }),
      this.prisma.teamSlot.count({ where: { tenant_id: tenantId, type: 'HUMAN' } }),
    ]);

    const layers: { layer: number; label: string; score: number; max: number; status: string; missing: string[] }[] = [
      {
        layer: 1, label: 'Founder DNA', max: 20,
        score: this.scoreFounderDNA(founder),
        status: founder?.atlas_calibrated_at ? 'calibrated' : founder ? 'partial' : 'empty',
        missing: this.missingFounderFields(founder),
      },
      {
        layer: 2, label: 'Operating Map', max: 10,
        score: this.scoreOperatingMap(operatingMap),
        status: operatingMap?.key_processes ? 'configured' : operatingMap ? 'partial' : 'empty',
        missing: this.missingOperatingMapFields(operatingMap),
      },
      {
        layer: 3, label: 'Culture Blueprint', max: 15,
        score: this.scoreCultureBlueprint(blueprint, cultureConfig),
        status: (blueprint?.operational_rules as any[])?.length ? 'configured' : 'empty',
        missing: this.missingBlueprintFields(blueprint, cultureConfig),
      },
      {
        layer: 4, label: 'Communication Voice', max: 15,
        score: this.scoreCommunicationProfile(commProfile),
        status: commProfile?.calibration_quality ?? 'none',
        missing: this.missingCommunicationFields(commProfile),
      },
      {
        layer: 5, label: 'Knowledge Ingestion', max: 15,
        score: await this.scoreKnowledge(tenantId),
        status: 'auto',
        missing: [],
      },
      {
        layer: 6, label: 'AI Role Design', max: 10,
        score: Math.min(10, agents * 2),
        status: agents >= 3 ? 'configured' : agents > 0 ? 'partial' : 'empty',
        missing: agents === 0 ? ['Crear al menos un agente IA alineado a la cultura'] : [],
      },
      {
        layer: 7, label: 'Team Adoption', max: 10,
        score: Math.min(10, slots * 2),
        status: slots >= 3 ? 'active' : slots > 0 ? 'partial' : 'empty',
        missing: slots === 0 ? ['Invitar al equipo a la plataforma'] : [],
      },
      {
        layer: 8, label: 'Living Culture System', max: 5,
        score: this.scoreLivingSystem(founder, commProfile, ksfs),
        status: ksfs > 0 && founder?.atlas_calibrated_at ? 'active' : 'inactive',
        missing: this.missingLivingSystemFields(founder, ksfs),
      },
    ];

    const total = layers.reduce((sum, l) => sum + l.score, 0);
    const maxTotal = layers.reduce((sum, l) => sum + l.max, 0);
    const health_score = Math.round((total / maxTotal) * 100);

    // Persistir el score
    await this.prisma.operatingMap.upsert({
      where:  { tenant_id: tenantId },
      create: { tenant_id: tenantId, health_score, health_breakdown: layers, last_health_check: new Date() },
      update: { health_score, health_breakdown: layers, last_health_check: new Date() },
    });

    return { health_score, layers, interpretation: this.interpretScore(health_score) };
  }

  // ── Full Culture OS (get everything) ────────────────────────────────────────

  async getFullCultureEngine(tenantId: string) {
    const [founder, commProfile, blueprint, operatingMap, cultureConfig, purpose] = await Promise.all([
      this.prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.cultureBlueprint.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.operatingMap.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.cultureConfig.findUnique({
        where: { tenant_id: tenantId },
        include: { principles: { where: { is_active: true } }, rituals: { where: { is_active: true } } },
      }),
      this.prisma.strategicPurpose.findUnique({ where: { tenant_id: tenantId } }),
    ]);

    return { founder_profile: founder, communication_profile: commProfile, culture_blueprint: blueprint, operating_map: operatingMap, culture_config: cultureConfig, strategic_purpose: purpose };
  }

  // ── Scoring helpers ──────────────────────────────────────────────────────────

  private scoreFounderDNA(p: any): number {
    if (!p) return 0;
    const fields = ['industry_change', 'differentiator', 'loved_behaviors', 'zero_tolerance',
      'doing_well_means', 'team_feeling', 'client_energy', 'ai_tasks', 'ai_never_replace'];
    const filled = fields.filter(f => p[f] && (Array.isArray(p[f]) ? p[f].length > 0 : true)).length;
    const base = Math.round((filled / fields.length) * 15);
    return p.atlas_calibrated_at ? base + 5 : base;
  }

  private missingFounderFields(p: any): string[] {
    if (!p) return ['Completar el perfil del fundador'];
    const missing: string[] = [];
    if (!p.industry_change) missing.push('¿Qué quieres cambiar en tu industria?');
    if (!p.differentiator)  missing.push('¿Qué hace diferente a tu empresa?');
    if (!p.doing_well_means) missing.push('¿Qué significa "hacerlo bien"?');
    if (!p.loved_behaviors?.length) missing.push('Comportamientos que amas en un colaborador');
    if (!p.zero_tolerance?.length)  missing.push('Lo que jamás tolerarías');
    if (!p.atlas_calibrated_at)     missing.push('Calibrar Atlas con tu perfil');
    return missing;
  }

  private scoreOperatingMap(m: any): number {
    if (!m) return 0;
    let score = 0;
    if ((m.current_systems as any[])?.length) score += 4;
    if ((m.key_processes as any[])?.length)   score += 4;
    if ((m.pain_points as any[])?.length)     score += 2;
    return score;
  }

  private missingOperatingMapFields(m: any): string[] {
    const missing: string[] = [];
    if (!m?.current_systems?.length) missing.push('Inventario de sistemas actuales');
    if (!m?.key_processes?.length)   missing.push('Procesos clave del negocio');
    return missing;
  }

  private scoreCultureBlueprint(b: any, c: any): number {
    let score = 0;
    if ((b?.operational_rules as any[])?.length) score += 5;
    if ((b?.response_standards as any[])?.length) score += 3;
    if ((b?.decision_frameworks as any[])?.length) score += 3;
    if ((c?.principles as any[])?.length) score += 4;
    return Math.min(15, score);
  }

  private missingBlueprintFields(b: any, c: any): string[] {
    const missing: string[] = [];
    if (!b?.operational_rules?.length)   missing.push('Reglas operativas (filosofía → comportamiento)');
    if (!b?.response_standards?.length)  missing.push('Tiempos de respuesta por canal');
    if (!c?.principles?.length)          missing.push('Principios operativos con comportamiento observable');
    return missing;
  }

  private scoreCommunicationProfile(p: any): number {
    if (!p?.samples_count) return 0;
    const q = p.calibration_quality;
    if (q === 'high')   return 15;
    if (q === 'medium') return 10;
    if (q === 'low')    return 5;
    return 2;
  }

  private missingCommunicationFields(p: any): string[] {
    if (!p?.samples_count) return ['Subir muestras de comunicación (WhatsApps, emails, propuestas)'];
    if (p.samples_count < 5)  return [`Subir ${5 - p.samples_count} muestras más para calibración media`];
    if (p.samples_count < 10) return [`Subir ${10 - p.samples_count} muestras más para calibración alta`];
    if (!p.last_calibrated_at) return ['Ejecutar calibración de voz'];
    return [];
  }

  private async scoreKnowledge(tenantId: string): Promise<number> {
    const [kbs, tasks] = await Promise.all([
      this.prisma.knowledgeBase.count({ where: { tenant_id: tenantId } }).catch(() => 0),
      this.prisma.task.count({ where: { tenant_id: tenantId } }),
    ]);
    if (kbs >= 3 || tasks >= 20) return 15;
    if (kbs >= 1 || tasks >= 5)  return 8;
    return 2;
  }

  private scoreLivingSystem(founder: any, comm: any, ksfs: number): number {
    let score = 0;
    if (founder?.atlas_calibrated_at) score += 2;
    if (comm?.last_calibrated_at)     score += 2;
    if (ksfs > 0)                     score += 1;
    return score;
  }

  private missingLivingSystemFields(founder: any, ksfs: number): string[] {
    const missing: string[] = [];
    if (!founder?.atlas_calibrated_at) missing.push('Calibrar Atlas con el perfil del fundador');
    if (!ksfs) missing.push('Configurar al menos un KSF de metas AUP');
    return missing;
  }

  private interpretScore(score: number): string {
    if (score >= 80) return '🟢 Culture Engine maduro — la empresa tiene identidad operativa sólida';
    if (score >= 60) return '🟡 Configuración avanzada — faltan algunos módulos para completar el sistema';
    if (score >= 35) return '🟠 Configuración básica — el sistema funciona pero la personalización es genérica';
    return '🔴 Configuración inicial — completa el Founder DNA y la voz para activar la ultra-personalización';
  }
}
