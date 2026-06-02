import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { SecretaryService } from './secretary.service';
import { BrainService } from '../brain/brain.service';
import { WhatsAppService } from './whatsapp.service';

const ATLAS_MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ITERATIONS = 10;
const MAX_TOKENS = 1500;

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
  ) {}

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
        const result = await this.executeTool(tenantId, block.name, block.input as Record<string, unknown>);
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

  private async executeTool(tenantId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
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
