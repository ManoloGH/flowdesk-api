import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AgentCalibrationService } from '../agent-calibration/agent-calibration.service';
import { AgentEvolutionService } from '../agent-evolution/agent-evolution.service';
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

@Injectable()
export class AgentPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calibration: AgentCalibrationService,
    private readonly evolution: AgentEvolutionService,
  ) {}

  async listModels() {
    return this.prisma.availableModel.findMany({
      where: { active: true },
      orderBy: [{ tier: 'asc' }, { display_name: 'asc' }],
    });
  }

  async getAgent(tenantId: string, agentId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
      select: {
        id: true,
        name: true,
        agent_role: true,
        agent_config: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');
    return slot;
  }

  async getDashboard(tenantId: string, agentId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
      select: { agent_role: true, agent_config: true },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    if (slot.agent_role === 'sales') {
      const cfg = (slot.agent_config as Record<string, unknown>) ?? {};
      const instanceName = cfg.instance_name as string | undefined;
      const botWhere = { tenant_id: tenantId, ...(instanceName ? { instance_name: instanceName } : {}) };

      const since24h = new Date(now.getTime() - 24 * 3_600_000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3_600_000);

      const [totalConvs, monthConvs, corrections, skills, handoffs, activeConvs, recentConvs, modeDist] =
        await Promise.all([
          this.prisma.botConversation.count({ where: botWhere }),
          this.prisma.botConversation.count({ where: { ...botWhere, created_at: { gte: monthStart } } }),
          this.prisma.agentCorrection.count({ where: { tenant_id: tenantId, agent_id: agentId } }),
          this.prisma.agentSkill.count({ where: { tenant_id: tenantId, agent_id: agentId, status: 'active' } }),
          this.prisma.botConversation.count({ where: { ...botWhere, mode: { not: 'AI' } } }),
          this.prisma.botConversation.count({ where: { ...botWhere, last_message_at: { gte: since24h } } }),
          this.prisma.botConversation.findMany({
            where: { ...botWhere, created_at: { gte: thirtyDaysAgo } },
            select: { created_at: true },
            orderBy: { created_at: 'asc' },
          }),
          this.prisma.botConversation.groupBy({ by: ['mode'], where: botWhere, _count: true }),
        ]);

      const dayMap: Record<string, number> = {};
      for (const conv of recentConvs) {
        const day = conv.created_at.toISOString().split('T')[0];
        dayMap[day] = (dayMap[day] ?? 0) + 1;
      }
      const volume30: { date: string; count: number }[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 3_600_000);
        const key = d.toISOString().split('T')[0];
        volume30.push({ date: key, count: dayMap[key] ?? 0 });
      }

      return {
        total_conversations: totalConvs,
        conversations_this_month: monthConvs,
        corrections_total: corrections,
        active_skills: skills,
        agent_role: slot.agent_role,
        handoffs_total: handoffs,
        active_conversations: activeConvs,
        volume_30_days: volume30,
        mode_distribution: modeDist.map(m => ({ mode: m.mode, count: m._count })),
      };
    }

    const [totalConvs, monthConvs, corrections, skills] = await Promise.all([
      this.prisma.agentConversation.count({
        where: { tenant_id: tenantId, agent_id: agentId },
      }),
      this.prisma.agentConversation.count({
        where: { tenant_id: tenantId, agent_id: agentId, created_at: { gte: monthStart } },
      }),
      this.prisma.agentCorrection.count({
        where: { tenant_id: tenantId, agent_id: agentId },
      }),
      this.prisma.agentSkill.count({
        where: { tenant_id: tenantId, agent_id: agentId, status: 'active' },
      }),
    ]);
    return {
      total_conversations: totalConvs,
      conversations_this_month: monthConvs,
      corrections_total: corrections,
      active_skills: skills,
      agent_role: slot.agent_role,
    };
  }

  async getConversations(tenantId: string, agentId: string, page = 1, limit = 20) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
      select: { agent_role: true, agent_config: true },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');

    const skip = (page - 1) * limit;

    if (slot.agent_role === 'sales') {
      const cfg = (slot.agent_config as Record<string, unknown>) ?? {};
      const instanceName = cfg.instance_name as string | undefined;
      const botWhere = { tenant_id: tenantId, ...(instanceName ? { instance_name: instanceName } : {}) };

      const [items, total] = await Promise.all([
        this.prisma.botConversation.findMany({
          where: botWhere,
          orderBy: { last_message_at: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            phone: true,
            contact_name: true,
            mode: true,
            instance_name: true,
            last_message_at: true,
            created_at: true,
            updated_at: true,
            _count: { select: { messages: true } },
          },
        }),
        this.prisma.botConversation.count({ where: botWhere }),
      ]);
      const mapped = items.map((item) => {
        const { _count, ...rest } = item as any;
        return { ...rest, messages_count: _count?.messages ?? 0 };
      });
      return { items: mapped, total, page, limit };
    }

    const [items, total] = await Promise.all([
      this.prisma.agentConversation.findMany({
        where: { tenant_id: tenantId, agent_id: agentId },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        select: { id: true, summary: true, session_id: true, started_at: true, ended_at: true, created_at: true },
      }),
      this.prisma.agentConversation.count({
        where: { tenant_id: tenantId, agent_id: agentId },
      }),
    ]);
    return { items, total, page, limit };
  }

  async getCorrections(tenantId: string, agentId: string, source?: string) {
    return this.prisma.agentCorrection.findMany({
      where: {
        tenant_id: tenantId,
        agent_id: agentId,
        ...(source ? { source } : {}),
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async createCorrection(tenantId: string, agentId: string, dto: CreateCorrectionDto) {
    await this.ensureAgent(tenantId, agentId);
    return this.prisma.agentCorrection.create({
      data: { tenant_id: tenantId, agent_id: agentId, ...dto },
    });
  }

  async getSkills(tenantId: string, agentId: string) {
    return this.prisma.agentSkill.findMany({
      where: { tenant_id: tenantId, agent_id: agentId },
      orderBy: { created_at: 'asc' },
    });
  }

  async createSkill(tenantId: string, agentId: string, dto: CreateSkillDto) {
    await this.ensureAgent(tenantId, agentId);
    return this.prisma.agentSkill.create({
      data: {
        tenant_id: tenantId,
        agent_id: agentId,
        ...dto,
        response_instructions: dto.response_instructions ?? '',
      },
    });
  }

  async updateSkill(
    tenantId: string,
    agentId: string,
    skillId: string,
    dto: UpdateSkillDto,
  ) {
    const skill = await this.prisma.agentSkill.findFirst({
      where: { id: skillId, agent_id: agentId, tenant_id: tenantId },
    });
    if (!skill) throw new NotFoundException('Skill no encontrado');
    return this.prisma.agentSkill.update({ where: { id: skillId }, data: dto });
  }

  async deleteSkill(tenantId: string, agentId: string, skillId: string) {
    const skill = await this.prisma.agentSkill.findFirst({
      where: { id: skillId, agent_id: agentId, tenant_id: tenantId },
    });
    if (!skill) throw new NotFoundException('Skill no encontrado');
    return this.prisma.agentSkill.delete({ where: { id: skillId } });
  }

  async getProspects(tenantId: string, agentId: string, page = 1, limit = 20) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
    });
    if (!slot) throw new NotFoundException('Agente de ventas no encontrado');

    const cfg = (slot.agent_config as Record<string, unknown>) ?? {};
    const instanceName = cfg.instance_name as string | undefined;
    const botWhere = { tenant_id: tenantId, ...(instanceName ? { instance_name: instanceName } : {}) };

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.botConversation.findMany({
        where: botWhere,
        orderBy: { last_message_at: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          phone: true,
          contact_name: true,
          mode: true,
          last_message_at: true,
          created_at: true,
        },
      }),
      this.prisma.botConversation.count({ where: botWhere }),
    ]);
    return { items, total, page, limit };
  }

  async getCalibratorData(tenantId: string, agentId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
      select: { agent_config: true, agent_role: true },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');

    const cfg = (slot.agent_config as Record<string, unknown>) ?? {};
    const [founderProfile, brainDocs, cultureBlueprint, operatingMap, commProfile] =
      await Promise.all([
        this.prisma.founderProfile.count({ where: { tenant_id: tenantId } }),
        this.prisma.empresaBrainDocument.count({ where: { tenant_id: tenantId } }),
        this.prisma.cultureBlueprint.count({ where: { tenant_id: tenantId } }),
        this.prisma.operatingMap.count({ where: { tenant_id: tenantId } }),
        this.prisma.communicationProfile.count({ where: { tenant_id: tenantId } }),
      ]);

    const pendingEvolution = await this.prisma.pendingApproval.findFirst({
      where: { tenant_id: tenantId, status: 'pending' },
      orderBy: { created_at: 'desc' },
    });

    const evolutionContext = pendingEvolution?.context as Record<string, unknown> | null;
    const isPendingForAgent =
      evolutionContext?.agent_id === agentId && evolutionContext?.type === 'agent_evolution';

    return {
      calibrated_at: cfg.calibrated_at ?? null,
      last_evolved_at: cfg.last_evolved_at ?? null,
      current_instructions: cfg.instructions ?? null,
      coverage: {
        founder_profile: founderProfile > 0,
        brain_docs: brainDocs,
        culture_blueprint: cultureBlueprint > 0,
        operating_map: operatingMap > 0,
        communication_profile: commProfile > 0,
      },
      pending_evolution: isPendingForAgent
        ? {
            id: pendingEvolution!.id,
            description: pendingEvolution!.description,
            context: pendingEvolution!.context,
            created_at: pendingEvolution!.created_at,
          }
        : null,
    };
  }

  async triggerCalibration(tenantId: string, agentId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
      select: { agent_role: true, owner_slot_id: true },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');

    if (slot.agent_role === 'ceo') {
      await this.calibration.calibrateCeoAgent(tenantId, agentId);
    } else if (slot.owner_slot_id) {
      await this.calibration.calibratePersonalAssistant(tenantId, agentId, slot.owner_slot_id);
    } else {
      await this.calibration.calibrateCompanyAgent(tenantId, agentId, slot.agent_role ?? 'sales');
    }
    return { success: true, message: 'Calibración completada' };
  }

  async getEvolutionStatus(tenantId: string, agentId: string) {
    const agentApprovals = await this.prisma.pendingApproval.findMany({
      where: {
        tenant_id: tenantId,
        status: 'pending',
        AND: [
          { context: { path: ['agent_id'], equals: agentId } },
          { context: { path: ['type'], equals: 'agent_evolution' } },
        ],
      },
      orderBy: { created_at: 'desc' },
    });

    const memories = await this.prisma.agentMemory.groupBy({
      by: ['memory_type'],
      where: { tenant_id: tenantId, agent_id: agentId },
      _count: { id: true },
    });

    return { pending_approvals: agentApprovals, memories };
  }

  async approveEvolution(tenantId: string, agentId: string, approvalId: string) {
    const approval = await this.prisma.pendingApproval.findFirst({
      where: { id: approvalId, tenant_id: tenantId, status: 'pending' },
    });
    if (!approval) throw new NotFoundException('Propuesta no encontrada');
    const ctx = approval.context as Record<string, unknown>;
    if (ctx?.agent_id !== agentId)
      throw new ForbiddenException('Esta propuesta no pertenece al agente especificado');
    await this.evolution.applyEvolution(tenantId, approvalId);
    return { success: true };
  }

  async rejectEvolution(tenantId: string, agentId: string, approvalId: string) {
    const approval = await this.prisma.pendingApproval.findFirst({
      where: { id: approvalId, tenant_id: tenantId, status: 'pending' },
    });
    if (!approval) throw new NotFoundException('Propuesta no encontrada');
    const ctx = approval.context as Record<string, unknown>;
    if (ctx?.agent_id !== agentId)
      throw new ForbiddenException('Esta propuesta no pertenece al agente especificado');
    await this.evolution.rejectEvolution(tenantId, approvalId);
    return { success: true };
  }

  async triggerEvolution(tenantId: string, agentId: string) {
    await this.evolution.evolveAgent(tenantId, agentId);
    return { success: true, message: 'Evolución iniciada' };
  }

  async getConversationMessages(tenantId: string, agentId: string, conversationId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
      select: { agent_config: true },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');

    const conv = await this.prisma.botConversation.findFirst({
      where: { id: conversationId, tenant_id: tenantId },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');

    const cfg = (slot.agent_config as Record<string, unknown>) ?? {};
    const instanceName = cfg.instance_name as string | undefined;
    if (instanceName && conv.instance_name !== instanceName)
      throw new ForbiddenException('La conversación no pertenece a este agente');

    const messages = await this.prisma.botMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      select: { id: true, role: true, content: true, created_at: true },
    });

    return { conversation: conv, messages };
  }

  async updateConfig(tenantId: string, agentId: string, dto: UpdateAgentConfigDto) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
      select: { agent_config: true },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');

    const current = (slot.agent_config as Record<string, unknown>) ?? {};
    const updated = { ...current, ...dto };

    return this.prisma.teamSlot.update({
      where: { id: agentId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { agent_config: updated as any },
      select: { id: true, agent_config: true },
    });
  }

  async getAuditLog(tenantId: string, agentId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: {
        tenant_id: tenantId,
        resource_type: 'team_slot',
        resource_id: agentId,
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        actor_id: true,
        payload: true,
        timestamp: true,
      },
    });
  }

  async testMessage(tenantId: string, agentId: string, dto: TestMessageDto) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
      select: { name: true, agent_config: true },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');

    const cfg = (slot.agent_config as Record<string, unknown>) ?? {};
    const model = (cfg.model as string) || 'openai/gpt-4o-mini';
    const agentName = (cfg.nombre as string) || slot.name || 'Asistente';
    const instructions = cfg.instructions as string | undefined;
    const pitch = cfg.pitch as string | undefined;
    const questions = Array.isArray(cfg.qualifying_questions)
      ? (cfg.qualifying_questions as string[])
      : [];

    const systemPrompt = instructions?.trim()
      ? instructions
      : [
          `Eres ${agentName}, un asistente de ventas.`,
          pitch ? `\nAcerca de la empresa: ${pitch}` : '',
          questions.length
            ? `\nPreguntas de calificación (hazlas en orden):\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new BadRequestException('Clave de API de IA no configurada en el servidor');

    const baseUrl = process.env.OPENROUTER_API_KEY
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.openai.com/v1';

    const history = (dto.history ?? []).slice(-20).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://app.flowdesk.mx',
        'X-Title': 'FlowDesk Agent Test',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: dto.message },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new BadRequestException(`Error del modelo IA: ${txt.slice(0, 150)}`);
    }

    const data = (await res.json()) as any;
    const response = data.choices?.[0]?.message?.content ?? '(Sin respuesta)';
    return { response };
  }

  // ── Catálogo de casos ──────────────────────────────────────────────────────

  async getCases(tenantId: string, agentId: string, search?: string) {
    await this.ensureAgent(tenantId, agentId);
    const where: any = { tenant_id: tenantId, agent_id: agentId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { linea: { contains: search, mode: 'insensitive' } },
        { area: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.agentCase.findMany({ where, orderBy: { created_at: 'asc' } });
  }

  async createCase(tenantId: string, agentId: string, dto: CreateCaseDto) {
    await this.ensureAgent(tenantId, agentId);
    return this.prisma.agentCase.create({
      data: { tenant_id: tenantId, agent_id: agentId, ...dto },
    });
  }

  async updateCase(tenantId: string, agentId: string, caseId: string, dto: UpdateCaseDto) {
    await this.ensureAgent(tenantId, agentId);
    return this.prisma.agentCase.update({
      where: { id: caseId },
      data: dto,
    });
  }

  async deleteCase(tenantId: string, agentId: string, caseId: string) {
    await this.ensureAgent(tenantId, agentId);
    return this.prisma.agentCase.delete({ where: { id: caseId } });
  }

  async searchCase(tenantId: string, agentId: string, query: string) {
    const cases = await this.getCases(tenantId, agentId, query);
    if (cases.length === 0) return { matched: null, all: [] };
    const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) return { matched: cases[0], all: cases };
    const caseList = cases.map((c, i) => `${i + 1}. [${c.name}] ${c.content.slice(0, 200)}`).join('\n');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        messages: [
          { role: 'system', content: 'Eres un asistente que identifica el caso más relevante dado un mensaje. Responde solo con el número del caso (1, 2, 3...) o "ninguno".' },
          { role: 'user', content: `Mensaje: "${query}"\n\nCasos disponibles:\n${caseList}` },
        ],
        max_tokens: 10,
      }),
    });
    const data = (await res.json()) as any;
    const idx = parseInt(data.choices?.[0]?.message?.content?.trim() ?? '0', 10) - 1;
    return { matched: cases[idx] ?? cases[0], all: cases };
  }

  // ── Clasificaciones ────────────────────────────────────────────────────────

  async getClassifications(tenantId: string, agentId: string, page = 1, limit = 20, source?: string, resolution?: string, feedback?: string) {
    await this.ensureAgent(tenantId, agentId);
    const where: any = { tenant_id: tenantId, agent_id: agentId };
    if (source && source !== 'all') where.source = source;
    if (resolution && resolution !== 'all') where.resolution = resolution;
    if (feedback && feedback !== 'all') where.feedback = feedback;
    const [items, total] = await Promise.all([
      this.prisma.agentClassification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.agentClassification.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async createClassification(tenantId: string, agentId: string, dto: CreateClassificationDto) {
    await this.ensureAgent(tenantId, agentId);
    return this.prisma.agentClassification.create({
      data: { tenant_id: tenantId, agent_id: agentId, ...dto },
    });
  }

  async updateClassificationFeedback(tenantId: string, agentId: string, id: string, feedback: string) {
    await this.ensureAgent(tenantId, agentId);
    return this.prisma.agentClassification.update({ where: { id }, data: { feedback } });
  }

  // ── Entregables ─────────────────────────────────────────────────────────────

  async getDeliverables(tenantId: string, agentId: string) {
    return this.prisma.agentDeliverable.findMany({
      where: { tenant_id: tenantId, agent_id: agentId },
      orderBy: { created_at: 'asc' },
    });
  }

  async createDeliverable(tenantId: string, agentId: string, dto: CreateDeliverableDto) {
    await this.ensureAgent(tenantId, agentId);
    return this.prisma.agentDeliverable.create({
      data: { tenant_id: tenantId, agent_id: agentId, ...dto },
    });
  }

  async updateDeliverable(tenantId: string, agentId: string, deliverableId: string, dto: UpdateDeliverableDto) {
    const del = await this.prisma.agentDeliverable.findFirst({
      where: { id: deliverableId, agent_id: agentId, tenant_id: tenantId },
    });
    if (!del) throw new NotFoundException('Entregable no encontrado');
    return this.prisma.agentDeliverable.update({ where: { id: deliverableId }, data: dto });
  }

  async deleteDeliverable(tenantId: string, agentId: string, deliverableId: string) {
    const del = await this.prisma.agentDeliverable.findFirst({
      where: { id: deliverableId, agent_id: agentId, tenant_id: tenantId },
    });
    if (!del) throw new NotFoundException('Entregable no encontrado');
    return this.prisma.agentDeliverable.delete({ where: { id: deliverableId } });
  }

  async getDeliverableResponses(tenantId: string, agentId: string, deliverableId: string) {
    return this.prisma.deliverableResponse.findMany({
      where: { tenant_id: tenantId, agent_id: agentId, deliverable_id: deliverableId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  async getDeliverableResponseByToken(token: string) {
    const response = await this.prisma.deliverableResponse.findUnique({
      where: { token },
      include: { deliverable: { select: { name: true, description: true, sections: true } } },
    });
    if (!response) throw new NotFoundException('Entregable no encontrado');
    return response;
  }

  private async ensureAgent(tenantId: string, agentId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');
    return slot;
  }
}
