import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { AgentCalibrationService } from '../agent-calibration/agent-calibration.service';

const EVOLUTION_MODEL = 'claude-sonnet-4-6';
const MIN_CONVERSATIONS_TO_EVOLVE = 5;

@Injectable()
export class AgentEvolutionService {
  private readonly logger = new Logger(AgentEvolutionService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private prisma: PrismaService,
    private calibration: AgentCalibrationService,
  ) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // ─── Cron semanal: lunes 6am — analiza y propone mejoras para todos los agentes

  @Cron('0 6 * * 1')
  async evolveAllTenants(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) return;

    this.logger.log('Iniciando ciclo de evolución semanal de agentes...');

    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'active' },
      select: { id: true, name: true },
    });

    for (const tenant of tenants) {
      try {
        await this.evolveAllAgentsForTenant(tenant.id);
      } catch (err) {
        this.logger.warn(`Error evolucionando agentes de ${tenant.name}: ${err}`);
      }
    }

    this.logger.log('Ciclo de evolución completado.');
  }

  async evolveAllAgentsForTenant(tenantId: string): Promise<{ evolved: number }> {
    const agents = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, type: 'AI_AGENT' },
      select: { id: true, name: true, agent_role: true, owner_slot_id: true },
    });

    let evolved = 0;
    for (const agent of agents) {
      const proposed = await this.evolveAgent(tenantId, agent.id);
      if (proposed) evolved++;
    }
    return { evolved };
  }

  // ─── Evoluciona un agente específico ────────────────────────────────────────

  async evolveAgent(tenantId: string, agentId: string): Promise<boolean> {
    if (!process.env.ANTHROPIC_API_KEY) return false;

    const [agent, recentConversations, corrections, patterns, gaps] = await Promise.all([
      this.prisma.teamSlot.findFirst({
        where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
        select: { name: true, agent_role: true, agent_config: true, owner_slot_id: true },
      }),
      this.getRecentConversationSample(agentId, 50),
      this.getMemoriesByType(agentId, 'correction', 20),
      this.getMemoriesByType(agentId, 'pattern', 20),
      this.getMemoriesByType(agentId, 'gap', 20),
    ]);

    if (!agent) return false;

    const totalConvs = await this.prisma.agentConversation.count({
      where: { agent_id: agentId },
    });

    if (totalConvs < MIN_CONVERSATIONS_TO_EVOLVE) return false;

    const currentInstructions = (agent.agent_config as any)?.instructions ?? '';

    const analysis = await this.analyzeAndPropose(
      agent.name,
      agent.agent_role ?? '',
      currentInstructions,
      recentConversations,
      corrections,
      patterns,
      gaps,
    );

    if (!analysis.has_improvements) return false;

    // Crear approval pendiente para que el CEO lo revise
    const ownerSlot = agent.owner_slot_id
      ? await this.prisma.teamSlot.findFirst({
          where: { id: agent.owner_slot_id },
          select: { id: true },
        })
      : await this.prisma.teamSlot.findFirst({
          where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
          select: { id: true },
        });

    if (!ownerSlot) return false;

    // Evitar duplicados: no crear si ya hay una propuesta pendiente para este agente
    const existingProposal = await this.prisma.pendingApproval.findFirst({
      where: {
        tenant_id: tenantId,
        status: 'pending',
        context: { path: ['type'], equals: 'agent_evolution' },
      },
    });

    // Filtrar si ya hay propuesta para este agente específico
    if (existingProposal) {
      const ctx = existingProposal.context as any;
      if (ctx?.agent_id === agentId) return false;
    }

    await this.prisma.pendingApproval.create({
      data: {
        tenant_id: tenantId,
        requested_by: agentId,
        description: `Atlas propone mejoras para ${agent.name} basadas en ${totalConvs} conversaciones`,
        context: {
          type: 'agent_evolution',
          agent_id: agentId,
          agent_name: agent.name,
          current_instructions: currentInstructions,
          proposed_instructions: analysis.proposed_instructions,
          analysis_summary: analysis.summary,
          improvements: analysis.improvements,
          stats: {
            total_conversations: totalConvs,
            corrections_found: corrections.length,
            patterns_found: patterns.length,
            gaps_found: gaps.length,
          },
        } as any,
      },
    });

    this.logger.log(`[${tenantId}] Propuesta de evolución creada para ${agent.name}`);
    return true;
  }

  // ─── Aplica una propuesta aprobada por el CEO ─────────────────────────────────

  async applyEvolution(tenantId: string, approvalId: string): Promise<{ applied: boolean; agent_name?: string }> {
    const approval = await this.prisma.pendingApproval.findFirst({
      where: { id: approvalId, tenant_id: tenantId, status: 'pending' },
    });

    if (!approval) return { applied: false };

    const ctx = approval.context as any;
    if (ctx?.type !== 'agent_evolution') return { applied: false };

    const agent = await this.prisma.teamSlot.findFirst({
      where: { id: ctx.agent_id, tenant_id: tenantId, type: 'AI_AGENT' },
      select: { id: true, agent_config: true },
    });

    if (!agent) return { applied: false };

    const current = (agent.agent_config as any) ?? {};
    await Promise.all([
      this.prisma.teamSlot.update({
        where: { id: agent.id },
        data: {
          agent_config: {
            ...current,
            instructions: ctx.proposed_instructions,
            last_evolved_at: new Date().toISOString(),
          },
        },
      }),
      this.prisma.pendingApproval.update({
        where: { id: approvalId },
        data: { status: 'approved', decided_at: new Date() },
      }),
    ]);

    return { applied: true, agent_name: ctx.agent_name };
  }

  // ─── Rechaza una propuesta de evolución ──────────────────────────────────────

  async rejectEvolution(tenantId: string, approvalId: string): Promise<void> {
    await this.prisma.pendingApproval.update({
      where: { id: approvalId, tenant_id: tenantId },
      data: { status: 'rejected', decided_at: new Date() },
    });
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────────

  private async getRecentConversationSample(agentId: string, limit: number): Promise<string> {
    const conversations = await this.prisma.agentConversation.findMany({
      where: { agent_id: agentId },
      orderBy: { started_at: 'desc' },
      take: limit,
      include: {
        messages: {
          orderBy: { created_at: 'asc' },
          take: 6,
          select: { role: true, content: true },
        },
      },
    });

    return conversations
      .map(c =>
        c.messages.map(m => `${m.role === 'user' ? 'Usuario' : 'Agente'}: ${m.content.slice(0, 200)}`).join('\n'),
      )
      .join('\n---\n')
      .slice(0, 8000);
  }

  private async getMemoriesByType(agentId: string, type: string, limit: number) {
    return this.prisma.agentMemory.findMany({
      where: { agent_id: agentId, memory_type: type },
      orderBy: [{ importance: 'desc' }, { created_at: 'desc' }],
      take: limit,
      select: { content: true, importance: true, created_at: true },
    });
  }

  private async analyzeAndPropose(
    agentName: string,
    agentRole: string,
    currentInstructions: string,
    conversationSample: string,
    corrections: any[],
    patterns: any[],
    gaps: any[],
  ): Promise<{
    has_improvements: boolean;
    proposed_instructions: string;
    summary: string;
    improvements: string[];
  }> {
    const correctionsList = corrections.map(c => `• ${c.content}`).join('\n');
    const patternsList = patterns.map(p => `• ${p.content}`).join('\n');
    const gapsList = gaps.map(g => `• ${g.content}`).join('\n');

    const prompt = `Eres un experto en optimización de agentes IA.
Analiza el rendimiento de un agente y propone mejoras concretas a sus instrucciones.

AGENTE: ${agentName} (rol: ${agentRole})

INSTRUCCIONES ACTUALES:
${currentInstructions || '(instrucciones básicas, sin personalización)'}

CORRECCIONES RECIBIDAS (errores del agente):
${correctionsList || '(ninguna)'}

PATRONES DE USO (qué pide frecuentemente el usuario):
${patternsList || '(ninguno detectado)'}

GAPS DETECTADOS (temas donde el agente no pudo responder bien):
${gapsList || '(ninguno)'}

MUESTRA DE CONVERSACIONES RECIENTES:
${conversationSample.slice(0, 4000) || '(sin conversaciones)'}

TAREA:
1. Identifica las 3-5 mejoras más impactantes para este agente
2. Genera instrucciones mejoradas incorporando estas mejoras
3. Explica el resumen de cambios

Responde SOLO con JSON válido:
{
  "has_improvements": true/false,
  "summary": "Resumen de qué cambia y por qué",
  "improvements": ["mejora 1", "mejora 2", ...],
  "proposed_instructions": "Las nuevas instrucciones completas del agente..."
}

Si las instrucciones actuales ya son excelentes y no hay mejoras claras, responde con has_improvements: false.`;

    try {
      const response = await this.anthropic.messages.create({
        model: EVOLUTION_MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { has_improvements: false, proposed_instructions: '', summary: '', improvements: [] };

      return JSON.parse(jsonMatch[0]);
    } catch {
      return { has_improvements: false, proposed_instructions: '', summary: '', improvements: [] };
    }
  }
}
