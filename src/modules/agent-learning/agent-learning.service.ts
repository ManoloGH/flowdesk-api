import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import Anthropic from '@anthropic-ai/sdk';
import { startOfWeek, subDays, endOfWeek } from 'date-fns';

@Injectable()
export class AgentLearningService {
  private readonly logger = new Logger(AgentLearningService.name);
  private anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(private prisma: PrismaService) {}

  // ─── Listar propuestas de un tenant ──────────────────────────────────────────

  async getProposals(tenantId: string, status?: string) {
    return this.prisma.agentLearningProposal.findMany({
      where: { tenant_id: tenantId, ...(status ? { status } : {}) },
      include: { agent: { select: { id: true, name: true, agent_role: true } } },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  // ─── Aprobar o rechazar una propuesta ────────────────────────────────────────

  async reviewProposal(tenantId: string, proposalId: string, reviewerSlotId: string, approve: boolean) {
    const proposal = await this.prisma.agentLearningProposal.findFirst({
      where: { id: proposalId, tenant_id: tenantId },
    });
    if (!proposal) throw new Error('Propuesta no encontrada');

    if (approve) {
      // Aplicar los cambios propuestos al agent_config del agente
      const agent = await this.prisma.teamSlot.findUnique({ where: { id: proposal.agent_id } });
      if (agent) {
        const currentConfig = (agent.agent_config as Record<string, unknown>) ?? {};
        const proposed = proposal.proposed_changes as Record<string, unknown>;
        const newConfig = { ...currentConfig, ...proposed };
        await this.prisma.teamSlot.update({
          where: { id: proposal.agent_id },
          data: { agent_config: newConfig as any },
        });
      }
    }

    return this.prisma.agentLearningProposal.update({
      where: { id: proposalId },
      data: {
        status: approve ? 'applied' : 'rejected',
        reviewed_by: reviewerSlotId,
        reviewed_at: new Date(),
      },
    });
  }

  // ─── Generar propuestas semanales para todos los agentes de un tenant ────────

  async generateWeeklyProposals(tenantId: string): Promise<void> {
    const weekStart = startOfWeek(subDays(new Date(), 7), { weekStartsOn: 1 });
    const weekEnd   = endOfWeek(subDays(new Date(), 7), { weekStartsOn: 1 });

    const agents = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, type: 'AI_AGENT', status: 'ONLINE' },
      select: { id: true, name: true, agent_role: true, agent_config: true, reports_to: { select: { id: true, name: true } } },
    });

    for (const agent of agents) {
      try {
        const conversations = await this.prisma.agentConversation.findMany({
          where: { tenant_id: tenantId, agent_id: agent.id, started_at: { gte: weekStart, lte: weekEnd } },
          include: { messages: { select: { role: true, content: true }, take: 30 } },
          take: 20,
        });

        if (conversations.length === 0) continue;

        const existing = await this.prisma.agentLearningProposal.findFirst({
          where: { agent_id: agent.id, week_start: weekStart, status: 'pending' },
        });
        if (existing) continue; // ya se generó para esta semana

        const transcript = conversations
          .slice(0, 5)
          .map((c, i) =>
            `--- Conversación ${i + 1} ---\n` +
            c.messages.map(m => `${m.role === 'user' ? 'Usuario' : 'Agente'}: ${m.content.slice(0, 300)}`).join('\n'),
          )
          .join('\n\n');

        const currentInstructions = (agent.agent_config as any)?.instructions ?? '';

        const response = await this.anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{
            role: 'user',
            content: `Eres un analizador de desempeño de agentes IA. Analiza estas conversaciones del agente "${agent.name}" (rol: ${agent.agent_role ?? 'general'}) de la semana pasada.

Instrucciones actuales del agente:
${currentInstructions.slice(0, 500)}

Conversaciones de la semana:
${transcript}

Responde SOLO con un JSON con esta estructura exacta:
{
  "summary": "Resumen en 2-3 oraciones de lo que pasó esta semana y qué mejoraría",
  "proposed_changes": {
    "instructions": "Nuevas instrucciones del agente si hay mejoras concretas, o null si no hay cambios",
    "tone_adjustment": "Ajuste de tono detectado, o null"
  },
  "has_meaningful_changes": true | false
}`,
          }],
        });

        const raw = response.content[0].type === 'text' ? response.content[0].text : '';
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) continue;

        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.has_meaningful_changes) continue;

        await this.prisma.agentLearningProposal.create({
          data: {
            tenant_id: tenantId,
            agent_id: agent.id,
            week_start: weekStart,
            proposal_type: 'pattern_detected',
            summary: parsed.summary,
            proposed_changes: parsed.proposed_changes,
            status: 'pending',
          },
        });

        // Notificar al supervisor (reports_to)
        if (agent.reports_to) {
          await this.prisma.notification.create({
            data: {
              slot_id: agent.reports_to.id,
              tenant_id: tenantId,
              type: 'agent_learning',
              title: `${agent.name} tiene propuestas de mejora`,
              content: parsed.summary,
              action_url: `/agents/${agent.id}?tab=learning`,
            },
          });
        }

        this.logger.log(`Propuesta de aprendizaje generada — agente ${agent.name} (${agent.id})`);
      } catch (err: any) {
        this.logger.error(`Error generando propuesta para agente ${agent.id}: ${err.message}`);
      }
    }
  }
}
