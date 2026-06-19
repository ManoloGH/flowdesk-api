import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AiProviderService } from '../../ai/ai-provider.service';
import { AiSystemBlock, AiTool } from '../../ai/interfaces/ai-provider.interface';
import { PersonalChatDto } from './dto/personal-assistant.dto';

const MAX_HISTORY = 30;
const MAX_TOKENS  = 1500;
const MAX_ITERS   = 5;

// ─── Herramientas por nivel ───────────────────────────────────────────────────

const EMPLOYEE_TOOLS: AiTool[] = [
  {
    name: 'get_my_tasks',
    description: 'Obtiene las tareas activas del usuario (pendientes y en progreso). Úsalo cuando el usuario pregunte qué tiene pendiente o qué debe hacer hoy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Filtrar por estado (opcional)' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Filtrar por prioridad (opcional)' },
      },
    },
  },
  {
    name: 'create_task',
    description: 'Crea una nueva tarea para el usuario. Úsalo cuando el usuario quiera registrar algo que debe hacer.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:       { type: 'string', description: 'Título de la tarea' },
        description: { type: 'string', description: 'Descripción detallada (opcional)' },
        priority:    { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Prioridad (default: medium)' },
        due_date:    { type: 'string', description: 'Fecha límite ISO (opcional), ej: 2026-06-20' },
        assignee_id: { type: 'string', description: 'ID del slot al que asignar la tarea (opcional, default: el propio usuario)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Actualiza el estado o prioridad de una tarea. Úsalo cuando el usuario complete, cancele o cambie una tarea.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id:  { type: 'string', description: 'ID de la tarea' },
        status:   { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'log_standup',
    description: 'Registra el standup diario del usuario: qué hizo ayer, qué hará hoy y si tiene bloqueantes. Llámalo cuando el usuario haga su check-in del día.',
    input_schema: {
      type: 'object' as const,
      properties: {
        hice:        { type: 'string', description: 'Qué hice ayer / últimamente' },
        hare:        { type: 'string', description: 'Qué haré hoy' },
        bloqueantes: { type: 'string', description: 'Impedimentos o bloqueantes (opcional)' },
      },
      required: ['hice', 'hare'],
    },
  },
  {
    name: 'get_standup_today',
    description: 'Obtiene el standup registrado hoy por el usuario.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'record_skill_signal',
    description: 'Registra una señal de habilidad del usuario basada en lo que acaba de hacer o demostrar. Úsalo silenciosamente cuando el usuario complete algo que revela una competencia.',
    input_schema: {
      type: 'object' as const,
      properties: {
        skill_name: { type: 'string', description: 'Nombre de la habilidad detectada, ej: negociación, SQL, gestión del tiempo' },
        level:      { type: 'number', description: 'Nivel estimado 1-10' },
        evidence:   { type: 'string', description: 'Qué acción o resultado generó esta señal' },
      },
      required: ['skill_name', 'evidence'],
    },
  },
];

const MANAGER_TOOLS: AiTool[] = [
  ...EMPLOYEE_TOOLS,
  {
    name: 'get_team_status',
    description: 'Obtiene el estado actual del equipo directo: personas, agentes IA, sus tareas activas y su estado de conexión.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_management_report',
    description: 'Obtiene el reporte semanal del equipo por zonas: Zona 1 (sobresalientes), Zona 2 (positivos), Zona 3 (crónicos), Zona 4 (negativos).',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_pending_approvals',
    description: 'Lista las aprobaciones pendientes que requieren la atención del gerente.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'approve_or_reject',
    description: 'Aprueba o rechaza una solicitud pendiente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        approval_id: { type: 'string', description: 'ID de la aprobación' },
        decision:    { type: 'string', enum: ['approved', 'rejected'] },
        comment:     { type: 'string', description: 'Comentario o razón (opcional)' },
      },
      required: ['approval_id', 'decision'],
    },
  },
  {
    name: 'reassign_task',
    description: 'Reasigna una tarea a otro miembro del equipo (humano o agente IA).',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id:         { type: 'string', description: 'ID de la tarea' },
        new_assignee_id: { type: 'string', description: 'ID del slot al que se reasigna' },
        reason:          { type: 'string', description: 'Razón del cambio (opcional)' },
      },
      required: ['task_id', 'new_assignee_id'],
    },
  },
  {
    name: 'get_team_skills',
    description: 'Muestra la matriz de habilidades del equipo, construida automáticamente de su historial de trabajo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        skill_name: { type: 'string', description: 'Filtrar por habilidad específica (opcional)' },
      },
    },
  },
];

const DIRECTOR_TOOLS: AiTool[] = [
  ...MANAGER_TOOLS,
  {
    name: 'get_org_health',
    description: 'Obtiene la salud organizacional general: score, alertas por área y estado de los departamentos.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_all_managers_status',
    description: 'Obtiene el estado de todos los managers que reportan al director y sus equipos.',
    input_schema: { type: 'object' as const, properties: {} },
  },
];

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PersonalAssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiProviderService,
  ) {}

  // ─── Entry point ─────────────────────────────────────────────────────────

  async chat(tenantId: string, slotId: string, dto: PersonalChatDto) {
    const user    = await this.getUser(tenantId, slotId);
    const agentId = await this.getOrCreatePersonalAgent(tenantId, slotId, user.name);
    const session = await this.getOrCreateSession(tenantId, agentId, slotId, dto.session_id);
    const history = await this.loadHistory(session.id);

    await this.saveMessage(session.id, 'user', dto.message);

    const systemBlocks = await this.buildSystemContext(tenantId, slotId, user);
    const tools        = this.getToolsForRole(user.role);

    const result = await this.ai.chatWithTools({
      tenantId,
      agentRole: 'daily_assistant',
      systemBlocks,
      historyMessages: history,
      userMessage: dto.message,
      tools,
      maxTokens:   MAX_TOKENS,
      maxIterations: MAX_ITERS,
      toolExecutor: (name, input) => this.executeTool(tenantId, slotId, agentId, user, name, input),
    });

    await this.saveMessage(session.id, 'assistant', result.response);

    return { text: result.response, session_id: session.id };
  }

  async getSessions(tenantId: string, slotId: string) {
    const agentId = await this.findPersonalAgent(tenantId, slotId);
    if (!agentId) return [];
    return this.prisma.agentConversation.findMany({
      where: { tenant_id: tenantId, human_id: slotId, agent_id: agentId },
      orderBy: { started_at: 'desc' },
      take: 20,
      select: { id: true, session_id: true, summary: true, started_at: true },
    });
  }

  async getSkillMatrix(tenantId: string, slotId: string) {
    const user    = await this.getUser(tenantId, slotId);
    const isManager = this.isManager(user.role);

    if (!isManager) {
      return this.getSkillsForSlot(slotId);
    }

    const team = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, reports_to_id: slotId, type: 'HUMAN' },
      select: { id: true, name: true },
    });

    const matrix = await Promise.all(
      team.map(async (m) => ({ ...m, skills: await this.getSkillsForSlot(m.id) }))
    );
    return matrix;
  }

  // ─── Context builder ─────────────────────────────────────────────────────

  private async buildSystemContext(tenantId: string, slotId: string, user: any): Promise<AiSystemBlock[]> {
    const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const [tasks, ksfs, standup] = await Promise.all([
      this.getMyTasksData(tenantId, slotId, { status: 'pending' }),
      this.getMyKsfsData(tenantId, slotId),
      this.getTodayStandupData(tenantId, slotId),
    ]);

    const inProgress = await this.getMyTasksData(tenantId, slotId, { status: 'in_progress' });
    const allTasks   = [...inProgress, ...tasks];

    let ctx = `Eres el asistente personal de ${user.name}, ${user.role} en ${user.tenantName}.
Hoy es ${today}.
Tu misión: ayudarle a ejecutar bien su día, gestionar su equipo y cumplir sus objetivos.

PERFIL:
- Nombre: ${user.name}
- Rol: ${user.role}
- Departamento: ${user.department ?? 'Sin departamento'}

MIS TAREAS ACTIVAS (${allTasks.length}):
${allTasks.map(t => `• [${t.status.toUpperCase()}] ${t.title} — ${t.priority}${t.due_date ? ` | vence ${new Date(t.due_date).toLocaleDateString('es-MX')}` : ''}`).join('\n') || '  Sin tareas activas'}

MIS KSFs:
${ksfs.map(k => `• ${k.name} (${k.unit}): ${k.last_status ?? 'SIN_DATO'} | tendencia ${k.last_trend ?? '-'}`).join('\n') || '  Sin KSFs configurados'}

STANDUP DE HOY:
${standup ? `  Hice: ${(standup.content as any).hice}\n  Haré: ${(standup.content as any).hare}\n  Bloqueantes: ${(standup.content as any).bloqueantes ?? 'Ninguno'}` : '  No registrado aún — puedes pedirme que lo registre'}
`;

    if (this.isManager(user.role)) {
      const [team, report, approvals] = await Promise.all([
        this.getTeamData(tenantId, slotId),
        this.getManagementReportData(tenantId, slotId),
        this.getPendingApprovalsData(tenantId),
      ]);

      ctx += `
MI EQUIPO (${team.length} miembros):
${team.map(m => `• ${m.name} (${m.type === 'AI_AGENT' ? 'Agente IA' : m.role}) — ${m.status}`).join('\n') || '  Sin reportes directos'}

REPORTE SEMANAL:
${report ? `  Zona 1 Sobresalientes: ${(report.zone1_outstanding as any[]).length}
  Zona 2 Positivos esta semana: ${(report.zone2_positives as any[]).length}
  Zona 3 Crónicos: ${(report.zone3_chronic as any[]).length}
  Zona 4 Negativos esta semana: ${(report.zone4_negatives as any[]).length}` : '  No disponible'}

APROBACIONES PENDIENTES: ${approvals.length}
${approvals.map(a => `• ${a.description} (solicitado por: ${a.requested_by})`).join('\n') || '  Ninguna'}
`;
    }

    if (this.isDirector(user.role)) {
      const health = await this.getOrgHealthData(tenantId, slotId);
      ctx += `
SALUD ORGANIZACIONAL: ${health.score ?? 'N/A'}/100
${health.issues?.slice(0, 5).map((i: any) => `⚠ ${i}`).join('\n') || '  Sin alertas críticas'}
`;
    }

    ctx += `
INSTRUCCIONES DE COMPORTAMIENTO:
- Responde siempre en español, de forma directa y accionable
- Usa las herramientas para consultar y actualizar datos reales — nunca inventes números
- Cuando el usuario logre algo, captura la señal de habilidad con record_skill_signal
- Si detectas un cuello de botella, saturación o riesgo, díselo proactivamente
- Sé conciso: el usuario está trabajando, no tiene tiempo para respuestas largas
- Para tareas y standups, confirma siempre que lo guardaste
`;

    return [{ type: 'text' as const, text: ctx }];
  }

  // ─── Tool router ─────────────────────────────────────────────────────────

  private async executeTool(tenantId: string, slotId: string, agentId: string, user: any, name: string, input: Record<string, any>): Promise<any> {
    switch (name) {
      // ── Employee tools ──
      case 'get_my_tasks':
        return this.getMyTasksData(tenantId, slotId, { status: input.status, priority: input.priority });

      case 'create_task':
        return this.prisma.task.create({
          data: {
            tenant_id:   tenantId,
            owner_id:    slotId,
            assignee_id: input.assignee_id ?? slotId,
            title:       input.title,
            description: input.description,
            priority:    input.priority ?? 'medium',
            due_date:    input.due_date ? new Date(input.due_date) : undefined,
          },
          select: { id: true, title: true, status: true, priority: true, due_date: true },
        });

      case 'update_task':
        return this.prisma.task.update({
          where: { id: input.task_id },
          data: {
            ...(input.status   && { status: input.status }),
            ...(input.priority && { priority: input.priority }),
            ...(input.status === 'completed' && { completed_at: new Date() }),
          },
          select: { id: true, title: true, status: true },
        });

      case 'log_standup': {
        const todayDate = new Date().toISOString().split('T')[0];
        const content   = { hice: input.hice, hare: input.hare, bloqueantes: input.bloqueantes ?? null, date: todayDate };
        const existing  = await this.getTodayStandupData(tenantId, slotId);
        if (existing) {
          return this.prisma.workReport.update({ where: { id: existing.id }, data: { content } });
        }
        return this.prisma.workReport.create({ data: { tenant_id: tenantId, slot_id: slotId, period: 'daily', content } });
      }

      case 'get_standup_today':
        return this.getTodayStandupData(tenantId, slotId);

      case 'record_skill_signal':
        return this.saveSkillSignal(tenantId, slotId, agentId, input.skill_name, input.level ?? 5, input.evidence);

      // ── Manager tools ──
      case 'get_team_status':
        return this.getTeamWithTasksData(tenantId, slotId);

      case 'get_management_report':
        return this.getManagementReportData(tenantId, slotId);

      case 'get_pending_approvals':
        return this.getPendingApprovalsData(tenantId);

      case 'approve_or_reject':
        return this.prisma.pendingApproval.update({
          where: { id: input.approval_id },
          data: {
            status:      input.decision,
            decided_by:  slotId,
            decided_at:  new Date(),
          },
        });

      case 'reassign_task':
        return this.prisma.task.update({
          where: { id: input.task_id },
          data: { assignee_id: input.new_assignee_id },
          select: { id: true, title: true, assignee: { select: { name: true } } },
        });

      case 'get_team_skills':
        return this.getTeamSkillsData(tenantId, slotId, input.skill_name);

      // ── Director tools ──
      case 'get_org_health':
        return this.getOrgHealthData(tenantId, slotId);

      case 'get_all_managers_status':
        return this.getAllManagersData(tenantId, slotId);

      default:
        return { error: `Herramienta desconocida: ${name}` };
    }
  }

  // ─── Data fetchers ───────────────────────────────────────────────────────

  private async getUser(tenantId: string, slotId: string) {
    const slot = await this.prisma.teamSlot.findUniqueOrThrow({
      where: { id: slotId },
      include: {
        department: { select: { name: true } },
        tenant:     { select: { name: true } },
      },
    });
    return {
      id:         slot.id,
      name:       slot.name,
      role:       slot.role,
      department: slot.department?.name ?? null,
      tenantName: slot.tenant.name,
    };
  }

  private async getMyTasksData(tenantId: string, slotId: string, filter?: { status?: string; priority?: string }) {
    const where: any = {
      tenant_id: tenantId,
      OR: [{ owner_id: slotId }, { assignee_id: slotId }],
    };
    if (filter?.status)   where.status   = filter.status;
    if (filter?.priority) where.priority = filter.priority;
    if (!filter?.status)  where.status   = { not: 'cancelled' };

    return this.prisma.task.findMany({
      where,
      select: { id: true, title: true, status: true, priority: true, due_date: true, assignee: { select: { name: true } } },
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { due_date: 'asc' }],
      take: 20,
    });
  }

  private async getMyKsfsData(tenantId: string, slotId: string) {
    const ksfs = await this.prisma.keySuccessFactor.findMany({
      where: { tenant_id: tenantId, team_slot_id: slotId, is_active: true },
      include: { measurements: { orderBy: { period: 'desc' }, take: 1 } },
    });
    return ksfs.map(k => ({
      id:          k.id,
      name:        k.name,
      unit:        k.unit,
      category:    k.category,
      last_status: k.measurements[0]?.status ?? null,
      last_trend:  k.measurements[0]?.trend  ?? null,
      last_actual: k.measurements[0]?.actual_value ?? null,
    }));
  }

  private async getTodayStandupData(tenantId: string, slotId: string) {
    return this.prisma.workReport.findFirst({
      where: { tenant_id: tenantId, slot_id: slotId, period: 'daily' },
      orderBy: { created_at: 'desc' },
    });
  }

  private async getTeamData(tenantId: string, slotId: string) {
    return this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, reports_to_id: slotId },
      select: { id: true, name: true, type: true, role: true, status: true, department: { select: { name: true } } },
    });
  }

  private async getTeamWithTasksData(tenantId: string, slotId: string) {
    const team = await this.getTeamData(tenantId, slotId);
    return Promise.all(team.map(async (member) => {
      const tasks = await this.prisma.task.count({
        where: { tenant_id: tenantId, assignee_id: member.id, status: { in: ['pending', 'in_progress'] } },
      });
      return { ...member, active_tasks: tasks };
    }));
  }

  private async getManagementReportData(tenantId: string, slotId: string) {
    return this.prisma.managementReport.findFirst({
      where: { tenant_id: tenantId, manager_slot_id: slotId },
      orderBy: { week_start: 'desc' },
    });
  }

  private async getPendingApprovalsData(tenantId: string) {
    return this.prisma.pendingApproval.findMany({
      where: { tenant_id: tenantId, status: 'pending' },
      orderBy: { created_at: 'asc' },
      take: 10,
    });
  }

  private async getOrgHealthData(tenantId: string, slotId: string) {
    const map = await this.prisma.operatingMap.findUnique({ where: { tenant_id: tenantId } });
    return { score: map?.health_score ?? null, issues: map?.pain_points ?? [] };
  }

  private async getAllManagersData(tenantId: string, slotId: string) {
    const managers = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, reports_to_id: slotId, role: 'manager' },
      select: { id: true, name: true, status: true },
    });
    return Promise.all(managers.map(async (m) => {
      const teamSize   = await this.prisma.teamSlot.count({ where: { tenant_id: tenantId, reports_to_id: m.id } });
      const openTasks  = await this.prisma.task.count({ where: { tenant_id: tenantId, owner_id: m.id, status: { in: ['pending', 'in_progress'] } } });
      const lastReport = await this.prisma.managementReport.findFirst({ where: { tenant_id: tenantId, manager_slot_id: m.id }, orderBy: { week_start: 'desc' } });
      return { ...m, team_size: teamSize, open_tasks: openTasks, has_weekly_report: !!lastReport };
    }));
  }

  private async getTeamSkillsData(tenantId: string, slotId: string, skillFilter?: string) {
    const team = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, reports_to_id: slotId, type: 'HUMAN' },
      select: { id: true, name: true },
    });
    return Promise.all(team.map(async (m) => {
      const skills = await this.getSkillsForSlot(m.id, skillFilter);
      return { ...m, skills };
    }));
  }

  private async getSkillsForSlot(slotId: string, skillFilter?: string) {
    const where: any = { owner_slot_id: slotId, memory_type: 'skill' };
    if (skillFilter) where.content = { contains: skillFilter, mode: 'insensitive' };

    const memories = await this.prisma.agentMemory.findMany({
      where,
      orderBy: { importance: 'desc' },
      take: 20,
    });

    return memories.map(m => {
      try {
        const data = JSON.parse(m.content);
        return { skill: data.skill_name, level: data.level, evidence: data.evidence, updated: m.updated_at };
      } catch {
        return { skill: m.content, level: 5, evidence: null, updated: m.updated_at };
      }
    });
  }

  private async saveSkillSignal(tenantId: string, slotId: string, agentId: string, skillName: string, level: number, evidence: string) {
    const content = JSON.stringify({ skill_name: skillName, level, evidence });

    const existing = await this.prisma.agentMemory.findFirst({
      where: { agent_id: agentId, owner_slot_id: slotId, memory_type: 'skill', content: { contains: skillName } },
    });

    if (existing) {
      return this.prisma.agentMemory.update({
        where: { id: existing.id },
        data: { content, importance: Math.min(10, level), access_count: { increment: 1 }, last_accessed: new Date() },
      });
    }

    return this.prisma.agentMemory.create({
      data: {
        tenant_id:     tenantId,
        agent_id:      agentId,
        owner_slot_id: slotId,
        memory_type:   'skill',
        content,
        importance:    Math.min(10, level),
        source_type:   'work_pattern',
      },
    });
  }

  // ─── Session management ──────────────────────────────────────────────────

  private async getOrCreatePersonalAgent(tenantId: string, ownerSlotId: string, ownerName: string): Promise<string> {
    const existing = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, owner_slot_id: ownerSlotId, agent_role: 'daily_assistant', type: 'AI_AGENT' },
      select: { id: true },
    });
    if (existing) return existing.id;

    const agent = await this.prisma.teamSlot.create({
      data: {
        tenant_id:     tenantId,
        owner_slot_id: ownerSlotId,
        name:          `Asistente de ${ownerName}`,
        type:          'AI_AGENT',
        role:          'employee',
        agent_role:    'daily_assistant',
        agent_scope:   'personal',
        status:        'ONLINE',
      },
      select: { id: true },
    });
    return agent.id;
  }

  private async findPersonalAgent(tenantId: string, ownerSlotId: string): Promise<string | null> {
    const agent = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, owner_slot_id: ownerSlotId, agent_role: 'daily_assistant', type: 'AI_AGENT' },
      select: { id: true },
    });
    return agent?.id ?? null;
  }

  private async getOrCreateSession(tenantId: string, agentId: string, humanId: string, sessionId?: string) {
    if (sessionId) {
      const existing = await this.prisma.agentConversation.findFirst({
        where: { tenant_id: tenantId, session_id: sessionId, human_id: humanId },
      });
      if (existing) return existing;
    }

    return this.prisma.agentConversation.create({
      data: { tenant_id: tenantId, agent_id: agentId, human_id: humanId },
    });
  }

  private async loadHistory(conversationId: string): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const messages = await this.prisma.agentMessage.findMany({
      where: { conversation_id: conversationId, role: { in: ['user', 'assistant'] } },
      orderBy: { created_at: 'asc' },
      take: MAX_HISTORY,
    });
    return messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  }

  private async saveMessage(conversationId: string, role: string, content: string) {
    await this.prisma.agentMessage.create({
      data: { conversation_id: conversationId, role, content },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private getToolsForRole(role: string): AiTool[] {
    if (this.isDirector(role)) return DIRECTOR_TOOLS;
    if (this.isManager(role))  return MANAGER_TOOLS;
    return EMPLOYEE_TOOLS;
  }

  private isManager(role: string)  { return ['manager', 'admin', 'owner'].includes(role); }
  private isDirector(role: string) { return ['admin', 'owner'].includes(role); }
}
