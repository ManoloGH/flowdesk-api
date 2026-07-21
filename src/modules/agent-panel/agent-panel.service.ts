import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AgentCalibrationService } from '../agent-calibration/agent-calibration.service';
import { AgentEvolutionService } from '../agent-evolution/agent-evolution.service';
import {
  CreateSkillDto,
  UpdateSkillDto,
  CreateCorrectionDto,
  UpdateAgentConfigDto,
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
      const [totalConvs, monthConvs, corrections, skills] = await Promise.all([
        this.prisma.botConversation.count({ where: { tenant_id: tenantId } }),
        this.prisma.botConversation.count({
          where: { tenant_id: tenantId, created_at: { gte: monthStart } },
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
      select: { agent_role: true },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');

    const skip = (page - 1) * limit;

    if (slot.agent_role === 'sales') {
      // BotConversation: id, phone, contact_name, mode, instance_name, last_message_at, created_at, updated_at
      const [items, total] = await Promise.all([
        this.prisma.botConversation.findMany({
          where: { tenant_id: tenantId },
          orderBy: { created_at: 'desc' },
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
          },
        }),
        this.prisma.botConversation.count({ where: { tenant_id: tenantId } }),
      ]);
      return { items, total, page, limit };
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
      data: { tenant_id: tenantId, agent_id: agentId, ...dto },
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

    const skip = (page - 1) * limit;
    // BotConversation no tiene status/stage/lead_score — devolvemos todas las
    // conversaciones del tenant ordenadas por última actividad
    const [items, total] = await Promise.all([
      this.prisma.botConversation.findMany({
        where: { tenant_id: tenantId },
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
      this.prisma.botConversation.count({ where: { tenant_id: tenantId } }),
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
    const pendingApprovals = await this.prisma.pendingApproval.findMany({
      where: { tenant_id: tenantId, status: 'pending' },
      orderBy: { created_at: 'desc' },
    });

    const agentApprovals = pendingApprovals.filter((p) => {
      const ctx = p.context as Record<string, unknown>;
      return ctx?.agent_id === agentId && ctx?.type === 'agent_evolution';
    });

    const memories = await this.prisma.agentMemory.groupBy({
      by: ['memory_type'],
      where: { tenant_id: tenantId, agent_id: agentId },
      _count: { id: true },
    });

    return { pending_approvals: agentApprovals, memories };
  }

  async approveEvolution(tenantId: string, _agentId: string, approvalId: string) {
    await this.evolution.applyEvolution(tenantId, approvalId);
    return { success: true };
  }

  async rejectEvolution(tenantId: string, _agentId: string, approvalId: string) {
    await this.evolution.rejectEvolution(tenantId, approvalId);
    return { success: true };
  }

  async triggerEvolution(tenantId: string, agentId: string) {
    await this.evolution.evolveAgent(tenantId, agentId);
    return { success: true, message: 'Evolución iniciada' };
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

  private async ensureAgent(tenantId: string, agentId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
    });
    if (!slot) throw new NotFoundException('Agente no encontrado');
    return slot;
  }
}
