import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { SecretaryService } from './secretary.service';
import { BrainService } from '../brain/brain.service';
import { WhatsAppService } from './whatsapp.service';
import { AgentConversationsService } from '../agent-conversations/agent-conversations.service';

const ATLAS_MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ITERATIONS = 10;
const MAX_TOKENS = 1500;

// phone → { agentId, agentName, sessionId }
const activeAgentSessions = new Map<string, { agentId: string; agentName: string; sessionId?: string }>();

const ATLAS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_pending_approvals',
    description: 'Obtiene las aprobaciones pendientes del owner.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'decide_approval',
    description: 'Aprueba o rechaza una solicitud pendiente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        approval_id: { type: 'string', description: 'ID de la aprobación' },
        decision: { type: 'string', enum: ['approved', 'rejected'] },
      },
      required: ['approval_id', 'decision'],
    },
  },
  {
    name: 'get_tasks',
    description: 'Lista las tareas del día del owner.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
      },
    },
  },
  {
    name: 'create_task',
    description: 'Crea una nueva tarea.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        due_date: { type: 'string', description: 'ISO date string opcional' },
      },
      required: ['title'],
    },
  },
  {
    name: 'search_brain',
    description: 'Busca información en el conocimiento de la empresa.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Qué buscar' },
        source_type: { type: 'string', description: 'Filtrar por tipo: onboarding, sop, culture, goal, etc.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_team_status',
    description: 'Estado del equipo: agentes online, tareas en progreso.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'list_agents',
    description: 'Lista los agentes IA disponibles de la empresa para que el owner pueda conectarse con uno.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'switch_to_agent',
    description: `Conecta al owner con un agente IA específico en este chat de WhatsApp.
Úsalo cuando el owner pida hablar con un agente ("pásame con el CEO Digital", "quiero hablar con Atlas", "@agente").
A partir de ese momento, los mensajes irán directo al agente seleccionado hasta que el owner diga "listo", "gracias" o "volver al secretario".`,
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id:   { type: 'string', description: 'ID del agente' },
        agent_name: { type: 'string', description: 'Nombre del agente' },
      },
      required: ['agent_id', 'agent_name'],
    },
  },
  {
    name: 'return_to_secretary',
    description: 'Termina la sesión con el agente activo y regresa el chat al Secretario.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'log_delegation',
    description: 'Registra una delegación de tarea.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to_slot_name: { type: 'string', description: 'Nombre del agente o persona' },
        task: { type: 'string', description: 'Descripción de la tarea' },
      },
      required: ['to_slot_name', 'task'],
    },
  },
];

@Injectable()
export class SecretaryAgentService {
  private readonly logger = new Logger(SecretaryAgentService.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretary: SecretaryService,
    private readonly brain: BrainService,
    private readonly whatsapp: WhatsAppService,
    @Inject(forwardRef(() => AgentConversationsService))
    private readonly agentConversations: AgentConversationsService,
  ) {}

  // ── Routing multi-agente ────────────────────────────────────────────────────

  hasActiveAgent(phone: string): boolean {
    return activeAgentSessions.has(phone);
  }

  getActiveAgent(phone: string) {
    return activeAgentSessions.get(phone) ?? null;
  }

  setActiveAgent(phone: string, agentId: string, agentName: string, sessionId?: string) {
    activeAgentSessions.set(phone, { agentId, agentName, sessionId });
  }

  clearActiveAgent(phone: string) {
    activeAgentSessions.delete(phone);
  }

  // Enruta el mensaje al agente activo y devuelve su respuesta
  async chatWithActiveAgent(tenantId: string, phone: string, message: string): Promise<string> {
    const session = activeAgentSessions.get(phone);
    if (!session) return '';

    const owner = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
      select: { id: true },
    });
    if (!owner) return '';

    // Detectar señales de cierre
    const closeSignals = ['listo', 'gracias', 'ok gracias', 'volver al secretario', 'volver', 'ya terminé', 'bye', 'hasta luego'];
    if (closeSignals.some(s => message.toLowerCase().includes(s))) {
      activeAgentSessions.delete(phone);
      return `De acuerdo, te regreso con tu Secretario. Fue un gusto chatear 👋`;
    }

    try {
      const result = await this.agentConversations.chat(
        tenantId,
        owner.id,
        session.agentId,
        { message, session_id: session.sessionId },
      );
      // Guardar session_id para continuidad
      if (result.conversation_id) {
        activeAgentSessions.set(phone, { ...session, sessionId: result.conversation_id });
      }
      return result.response;
    } catch {
      return `No pude conectarme con ${session.agentName} en este momento. Intenta de nuevo.`;
    }
  }

  async chat(tenantId: string, message: string, ownerPhone: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, mission: true, tagline: true },
    });

    const config = await this.secretary.getConfig(tenantId);
    const pendingCount = (await this.secretary.getPendingApprovals(tenantId)).length;

    const systemPrompt = `Eres Atlas, el Secretario Personal del founder de ${tenant?.name ?? 'la empresa'}.

EMPRESA: ${tenant?.name} — ${tenant?.tagline ?? ''}
MISIÓN: ${tenant?.mission ?? ''}

Tu trabajo es gestionar el día a día del founder de forma proactiva y precisa:
- Coordinar tareas, aprobaciones y delegaciones
- Responder preguntas sobre la empresa con información de la base de conocimiento
- Dar el morning brief cada mañana con las prioridades del día
- Gestionar aprobaciones pendientes y escalar solo lo que requiere decisión del founder

${pendingCount > 0 ? `⚠️ Hay ${pendingCount} aprobación(es) pendiente(s).` : ''}

MULTI-AGENTE: Si el owner pide hablar con un agente específico ("pásame con el CEO Digital", "quiero hablar con Atlas", "@[nombre]"), usa list_agents para ver los disponibles y luego switch_to_agent. Di: "Te conecto con [nombre], un momento..." — el agente tomará el chat a partir del siguiente mensaje. Para regresar al Secretario, el owner puede decir "listo", "volver" o "gracias".

TONO: Directo, ejecutivo, conciso. Máximo 3-4 líneas en WhatsApp.
Usa emojis con moderación para facilitar la lectura en móvil.
Responde SIEMPRE en español.`;

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: message },
    ];

    let response = await this.anthropic.messages.create({
      model: ATLAS_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: ATLAS_TOOLS,
      messages,
    });

    let iterations = 0;
    while (response.stop_reason === 'tool_use' && iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await this.executeTool(tenantId, block.name, block.input as Record<string, unknown>, ownerPhone);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await this.anthropic.messages.create({
        model: ATLAS_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: ATLAS_TOOLS,
        messages,
      });
    }

    const text = response.content.find(b => b.type === 'text');
    return text ? (text as Anthropic.TextBlock).text : 'No pude procesar tu mensaje. Intenta de nuevo.';
  }

  async sendMorningBrief(tenantId: string): Promise<void> {
    const config = await this.secretary.getConfig(tenantId);
    if (!config?.enabled || !config.morning_brief_enabled) return;

    const instance = await this.secretary.getEvolutionInstance(tenantId);
    if (!instance) return;

    const brief = await this.generateBrief(tenantId);
    await this.whatsapp.send(instance, config.owner_phone, brief);
    this.logger.log(`Morning brief sent to ${tenantId}`);
  }

  private async generateBrief(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    const [tasks, approvals, team] = await Promise.all([
      this.prisma.task.findMany({
        where: { tenant_id: tenantId, status: { in: ['pending', 'in_progress'] } },
        orderBy: [{ priority: 'asc' }, { due_date: 'asc' }],
        take: 5,
        select: { title: true, priority: true, status: true },
      }),
      this.secretary.getPendingApprovals(tenantId),
      this.prisma.teamSlot.findMany({
        where: { tenant_id: tenantId, type: 'AI_AGENT', status: 'ONLINE' },
        select: { name: true, agent_role: true },
      }),
    ]);

    const now = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

    const lines = [
      `🌅 *Buenos días* — ${now}`,
      `*${tenant?.name ?? 'Tu empresa'}*`,
      '',
    ];

    if (approvals.length > 0) {
      lines.push(`⚠️ *${approvals.length} aprobación(es) pendiente(s)*`);
      approvals.slice(0, 3).forEach(a => lines.push(`  • ${a.description}`));
      lines.push('');
    }

    if (tasks.length > 0) {
      lines.push(`📋 *Prioridades del día:*`);
      tasks.forEach(t => {
        const icon = t.priority === 'urgent' ? '🔴' : t.priority === 'high' ? '🟠' : '🟡';
        lines.push(`  ${icon} ${t.title}`);
      });
      lines.push('');
    }

    if (team.length > 0) {
      lines.push(`🤖 *Agentes activos:* ${team.map(a => a.name).join(', ')}`);
    }

    lines.push('');
    lines.push('_¿Qué necesitas hoy?_');

    return lines.join('\n');
  }

  private async executeTool(tenantId: string, name: string, input: Record<string, unknown>, ownerPhone = ''): Promise<unknown> {
    try {
      switch (name) {
        case 'get_pending_approvals':
          return await this.secretary.getPendingApprovals(tenantId);

        case 'decide_approval': {
          const ownerSlot = await this.prisma.teamSlot.findFirst({
            where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
          });
          return await this.secretary.decide(
            tenantId,
            input.approval_id as string,
            input.decision as 'approved' | 'rejected',
            ownerSlot?.id ?? 'owner',
          );
        }

        case 'get_tasks':
          return await this.prisma.task.findMany({
            where: {
              tenant_id: tenantId,
              ...(input.status ? { status: input.status as string } : { status: { in: ['pending', 'in_progress'] } }),
            },
            orderBy: [{ priority: 'asc' }, { due_date: 'asc' }],
            take: 10,
            select: { id: true, title: true, priority: true, status: true, due_date: true },
          });

        case 'create_task': {
          const owner = await this.prisma.teamSlot.findFirst({
            where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
          });
          if (!owner) return { error: 'Owner not found' };
          return await this.prisma.task.create({
            data: {
              tenant_id:  tenantId,
              owner_id:   owner.id,
              title:      input.title as string,
              priority:   (input.priority as string) ?? 'medium',
              due_date:   input.due_date ? new Date(input.due_date as string) : null,
            },
          });
        }

        case 'search_brain':
          return await this.brain.search(tenantId, input.query as string, {
            limit: 4,
            source_type: input.source_type as string | undefined,
          });

        case 'get_team_status':
          return await this.prisma.teamSlot.findMany({
            where: { tenant_id: tenantId },
            select: { name: true, type: true, role: true, status: true, agent_role: true },
            orderBy: [{ type: 'asc' }, { status: 'asc' }],
          });

        case 'list_agents':
          return await this.prisma.teamSlot.findMany({
            where: { tenant_id: tenantId, type: 'AI_AGENT' },
            select: { id: true, name: true, agent_role: true, status: true },
            orderBy: { name: 'asc' },
          });

        case 'switch_to_agent': {
          this.setActiveAgent(ownerPhone, input.agent_id as string, input.agent_name as string);
          return { ok: true, switched_to: input.agent_name };
        }

        case 'return_to_secretary': {
          this.clearActiveAgent(ownerPhone);
          return { ok: true };
        }

        case 'log_delegation': {
          const owner = await this.prisma.teamSlot.findFirst({
            where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
          });
          const target = await this.prisma.teamSlot.findFirst({
            where: { tenant_id: tenantId, name: { contains: input.to_slot_name as string, mode: 'insensitive' } },
          });
          if (!owner || !target) return { error: 'Slot not found' };
          return await this.secretary.logDelegation(tenantId, owner.id, target.id, input.task as string);
        }

        default:
          return { error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      this.logger.error(`Tool ${name} error: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  }
}
