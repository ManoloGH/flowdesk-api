import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';

const CALIBRATION_MODEL = 'claude-sonnet-4-6';

@Injectable()
export class AgentCalibrationService {
  private readonly logger = new Logger(AgentCalibrationService.name);
  private readonly anthropic: Anthropic;

  constructor(private prisma: PrismaService) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // ─── Entry point — calibra todos los agentes del tenant ─────────────────────

  async calibrateAllAgents(tenantId: string): Promise<{ calibrated: number; skipped: number }> {
    if (!process.env.ANTHROPIC_API_KEY) return { calibrated: 0, skipped: 0 };

    const agents = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, type: 'AI_AGENT' },
      select: { id: true, name: true, agent_role: true, owner_slot_id: true, agent_config: true },
    });

    let calibrated = 0;
    let skipped = 0;

    for (const agent of agents) {
      try {
        if (agent.agent_role === 'ceo') {
          await this.calibrateCeoAgent(tenantId, agent.id);
        } else if (agent.owner_slot_id) {
          await this.calibratePersonalAssistant(tenantId, agent.id, agent.owner_slot_id);
        } else {
          await this.calibrateCompanyAgent(tenantId, agent.id, agent.agent_role ?? 'assistant');
        }
        calibrated++;
      } catch (err) {
        this.logger.warn(`No se pudo calibrar agente ${agent.name}: ${err}`);
        skipped++;
      }
    }

    this.logger.log(`[${tenantId}] Calibración completa: ${calibrated} calibrados, ${skipped} omitidos`);
    return { calibrated, skipped };
  }

  // ─── CEO Agent — usa todo el contexto de la empresa ─────────────────────────

  async calibrateCeoAgent(tenantId: string, agentId: string): Promise<void> {
    const [tenant, founder, blueprint, operatingMap, voice, brainSummary, team] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, plan: true } }),
      this.prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.cultureBlueprint.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.operatingMap.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.empresaBrainDocument.findMany({
        where: { tenant_id: tenantId },
        select: { title: true, content: true, source_type: true },
        take: 20,
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.teamSlot.findMany({
        where: { tenant_id: tenantId, type: 'HUMAN' },
        select: { id: true, name: true, role: true, department: { select: { name: true } } },
      }),
    ]);

    const context = this.buildCeoContext(tenant, founder, blueprint, operatingMap, voice, brainSummary, team);

    const instructions = await this.generateInstructions(`
Eres un experto en diseño de CEO Agents para empresas IA-first.
Genera las instrucciones del sistema para un CEO Agent altamente personalizado.
El agente debe ser ejecutivo, directo y actuar como socio estratégico del CEO.

${context}

INSTRUCCIONES PARA GENERAR:
1. Identidad y misión del agente con esta empresa específica
2. Qué información clave tiene (empresa, equipo, procesos, cultura)
3. Cómo debe priorizar y responder según los valores del fundador
4. Qué comportamientos debe reforzar y señalar
5. Tono y estilo alineado con la voz de la empresa
6. Reglas operativas derivadas de la cultura

Genera instrucciones directas en primera persona (el agente hablando de sí mismo).
Máximo 700 palabras. Solo las instrucciones, sin explicaciones adicionales. En español.`);

    await this.updateAgentInstructions(agentId, instructions);
  }

  // ─── Asistente personal — calibrado según KSFs y rol del empleado ────────────

  async calibratePersonalAssistant(tenantId: string, agentId: string, ownerSlotId: string): Promise<void> {
    const [tenant, employee, ksfs, voice, founder] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.teamSlot.findFirst({
        where: { id: ownerSlotId, tenant_id: tenantId },
        select: { name: true, role: true, department: { select: { name: true } } },
      }),
      this.prisma.keySuccessFactor.findMany({
        where: { tenant_id: tenantId, team_slot_id: ownerSlotId },
        select: { name: true, description: true, level: true },
        take: 10,
      }),
      this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } }),
    ]);

    if (!employee) return;

    const ksfList = ksfs.map(k => `- ${k.name}: ${k.description ?? ''} (${k.level})`).join('\n');
    const voiceDesc = voice?.voice_summary ?? '';
    const companyValues = (founder?.loved_behaviors as string[] | null)?.join(', ') ?? '';

    const instructions = await this.generateInstructions(`
Eres un experto en diseño de asistentes IA personales para ejecutivos.
Genera las instrucciones del sistema para un asistente personal de ${employee.name}.

PERSONA:
- Nombre: ${employee.name}
- Rol: ${employee.role}
- Área: ${employee.department?.name ?? 'General'}
- Empresa: ${tenant?.name ?? ''}

RESULTADOS CLAVE (KSFs) — en qué se mide su éxito:
${ksfList || '(sin KSFs configurados aún)'}

CULTURA DE LA EMPRESA:
${companyValues ? `Comportamientos valorados: ${companyValues}` : ''}
${voiceDesc ? `Voz y tono: ${voiceDesc}` : ''}

INSTRUCCIONES PARA GENERAR:
1. Identidad del asistente como apoyo personal de ${employee.name}
2. Qué debe priorizar según sus KSFs y responsabilidades
3. Cómo ayudar a gestionar tiempo, tareas y objetivos
4. Tono adaptado al rol (ejecutivo, operativo, técnico, etc.)
5. Qué alertas y seguimientos hacer proactivamente

Genera instrucciones en primera persona. Máximo 400 palabras. Solo las instrucciones, en español.`);

    await this.updateAgentInstructions(agentId, instructions);
  }

  // ─── Agente de área/empresa — usa contexto general ───────────────────────────

  async calibrateCompanyAgent(tenantId: string, agentId: string, agentRole: string): Promise<void> {
    const [tenant, blueprint, brainDocs] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.cultureBlueprint.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.empresaBrainDocument.findMany({
        where: { tenant_id: tenantId },
        select: { title: true, content: true, source_type: true },
        take: 10,
        orderBy: { created_at: 'asc' },
      }),
    ]);

    const roleDescriptions: Record<string, string> = {
      focus_agent:     'agente de enfoque personal que ayuda a priorizar tareas y gestión del tiempo',
      daily_assistant: 'asistente de jornada diaria que organiza el día y coordina la agenda',
      department_agent:'agente de departamento que apoya al equipo con información y procesos',
      company_agent:   'agente empresarial con visibilidad completa de la organización',
    };

    const roleDesc = roleDescriptions[agentRole] ?? 'agente de asistencia empresarial';
    const philosophyList = (blueprint?.philosophy_statements as string[] | null)?.slice(0, 5).join('\n- ') ?? '';
    const brainSummary = brainDocs.map(d => `[${d.source_type}] ${d.title}`).join('\n');

    const instructions = await this.generateInstructions(`
Genera instrucciones para un ${roleDesc} de ${tenant?.name ?? 'la empresa'}.

FILOSOFÍA DE LA EMPRESA:
${philosophyList ? `- ${philosophyList}` : '(sin filosofía documentada)'}

CONOCIMIENTO DISPONIBLE EN BRAIN:
${brainSummary || '(sin documentos en Brain aún)'}

Genera instrucciones directas, concisas y alineadas con la cultura de la empresa.
Máximo 300 palabras. Solo las instrucciones, en español.`);

    await this.updateAgentInstructions(agentId, instructions);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private buildCeoContext(
    tenant: any,
    founder: any,
    blueprint: any,
    operatingMap: any,
    voice: any,
    brain: any[],
    team: any[],
  ): string {
    const lines: string[] = [];

    lines.push(`EMPRESA: ${tenant?.name ?? 'N/A'} (plan: ${tenant?.plan ?? 'N/A'})`);

    if (founder) {
      lines.push('\nFOUNDER DNA:');
      if (founder.industry_change) lines.push(`- Qué quiere cambiar: ${founder.industry_change}`);
      if (founder.differentiator)  lines.push(`- Diferenciador: ${founder.differentiator}`);
      if (founder.doing_well_means) lines.push(`- Hacer las cosas bien significa: ${founder.doing_well_means}`);
      if (founder.team_feeling)    lines.push(`- Cómo quiere que se sienta el equipo: ${founder.team_feeling}`);
      if (founder.zero_tolerance?.length) lines.push(`- Jamás tolera: ${(founder.zero_tolerance as string[]).join(', ')}`);
      if (founder.loved_behaviors?.length) lines.push(`- Ama ver: ${(founder.loved_behaviors as string[]).join(', ')}`);
      if (founder.ai_tasks?.length) lines.push(`- IA debe hacer: ${(founder.ai_tasks as string[]).join(', ')}`);
      if (founder.ai_never_replace?.length) lines.push(`- IA jamás reemplaza: ${(founder.ai_never_replace as string[]).join(', ')}`);
    }

    if (blueprint) {
      const rules = (blueprint.operational_rules as any[] | null) ?? [];
      if (rules.length) {
        lines.push('\nREGLAS OPERATIVAS:');
        rules.slice(0, 5).forEach(r => lines.push(`- Si ${r.trigger}: ${r.expected_behavior}`));
      }
    }

    if (voice?.voice_summary) {
      lines.push(`\nVOZ Y TONO: ${voice.voice_summary}`);
    }

    if (brain.length) {
      lines.push('\nCONOCIMIENTO EN BRAIN:');
      brain.slice(0, 10).forEach(d => lines.push(`- [${d.source_type}] ${d.title}`));
    }

    const processes = (operatingMap?.key_processes as any[] | null) ?? [];
    if (processes.length) {
      lines.push('\nPROCESOS CLAVE:');
      processes.slice(0, 5).forEach(p => lines.push(`- ${p.name} (owner: ${p.owner_name})`));
    }

    if (team.length) {
      lines.push(`\nEQUIPO (${team.length} personas):`);
      team.slice(0, 8).forEach(m => lines.push(`- ${m.name} (${m.role}${m.department ? ', ' + m.department.name : ''})`));
    }

    return lines.join('\n');
  }

  private async generateInstructions(prompt: string): Promise<string> {
    if (!process.env.ANTHROPIC_API_KEY) return 'Asistente FlowDesk. Ayuda al usuario de forma clara y proactiva.';

    const response = await this.anthropic.messages.create({
      model: CALIBRATION_MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  private async updateAgentInstructions(agentId: string, instructions: string): Promise<void> {
    if (!instructions) return;
    const agent = await this.prisma.teamSlot.findUnique({ where: { id: agentId }, select: { agent_config: true } });
    const current = (agent?.agent_config as any) ?? {};
    await this.prisma.teamSlot.update({
      where: { id: agentId },
      data: { agent_config: { ...current, instructions, calibrated_at: new Date().toISOString() } },
    });
  }
}
