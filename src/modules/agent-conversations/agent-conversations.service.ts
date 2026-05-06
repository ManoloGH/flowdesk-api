import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { AgentMemoryService } from '../agent-memory/agent-memory.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { GoogleAdapter } from '../../integrations/google/google.adapter';
import { M365Adapter } from '../../integrations/m365/m365.adapter';
import { ChatDto } from './dto/agent-conversations.dto';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const CEO_MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY_MESSAGES = 20;
const MAX_RESPONSE_TOKENS = 2000;
const MAX_TOOL_ITERATIONS = 6;

// ─── Herramientas del CEO Agent ──────────────────────────────────────────────

const CEO_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_tasks',
    description: 'Obtiene las tareas del usuario con filtros opcionales de estado y prioridad.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'], description: 'Filtrar por estado' },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'], description: 'Filtrar por prioridad' },
      },
    },
  },
  {
    name: 'create_task',
    description: 'Crea una nueva tarea para el usuario.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Título de la tarea' },
        description: { type: 'string', description: 'Descripción opcional' },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        due_date: { type: 'string', description: 'Fecha límite en formato ISO (opcional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Actualiza el estado, prioridad o título de una tarea existente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'ID de la tarea' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        title: { type: 'string' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'get_productivity_summary',
    description: 'Resumen de productividad: pendientes, en progreso, completadas hoy, vencidas y metas activas.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_agents',
    description: 'Lista todos los agentes IA disponibles en la empresa.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'create_agent',
    description: 'Crea un agente IA con instrucciones manuales. Para agentes más sofisticados usa design_and_create_agent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre del agente' },
        instructions: { type: 'string', description: 'Instrucciones del agente' },
      },
      required: ['name', 'instructions'],
    },
  },
  {
    name: 'design_and_create_agent',
    description: `Diseña y crea un agente IA usando IA para generar instrucciones profesionales y detalladas.
Úsalo cuando el usuario confirme que quiere un agente nuevo — este tool invoca Claude para diseñar
instrucciones óptimas para ese rol específico, mucho más completas que las que escribirías manualmente.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_name: {
          type: 'string',
          description: 'Nombre elegido por el usuario para el agente',
        },
        role_description: {
          type: 'string',
          description: 'Descripción detallada del rol: qué hace, para qué área, casos de uso concretos. Más detalle = mejor agente.',
        },
        context: {
          type: 'string',
          description: 'Contexto adicional: industria de la empresa, procesos específicos, integraciones, tono de comunicación',
        },
      },
      required: ['agent_name', 'role_description'],
    },
  },
  {
    name: 'get_goals',
    description: 'Lista los objetivos y metas del usuario.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'create_goal',
    description: 'Crea un nuevo objetivo para el usuario.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        goal_type: { type: 'string', enum: ['personal', 'professional', 'sales', 'team'] },
        period: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly', 'annual'] },
        target_value: { type: 'number', description: 'Valor numérico objetivo (opcional)' },
        unit: { type: 'string', description: 'Unidad de medida: ventas, clientes, horas, etc.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_calendar_events',
    description: 'Obtiene los eventos del calendario del usuario (Google Calendar o Outlook) para un período. Úsalo para revisar disponibilidad o agenda.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start: { type: 'string', description: 'Fecha/hora inicio ISO 8601 (ej. 2025-05-04T00:00:00)' },
        end: { type: 'string', description: 'Fecha/hora fin ISO 8601 (ej. 2025-05-04T23:59:59)' },
        provider: { type: 'string', enum: ['google', 'microsoft365'], description: 'Proveedor — auto-detecta si no se indica' },
      },
      required: ['start', 'end'],
    },
  },
  {
    name: 'create_meeting',
    description: 'Crea una reunión en el calendario con link de Google Meet o Microsoft Teams.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Título de la reunión' },
        start: { type: 'string', description: 'Fecha/hora inicio ISO 8601' },
        end: { type: 'string', description: 'Fecha/hora fin ISO 8601' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Lista de emails de los participantes' },
        provider: { type: 'string', enum: ['google', 'microsoft365'], description: 'Proveedor — auto-detecta si no se indica' },
      },
      required: ['title', 'start', 'end', 'attendees'],
    },
  },
  {
    name: 'get_inbox',
    description: 'Lee los emails más recientes del inbox del usuario (Gmail u Outlook).',
    input_schema: {
      type: 'object' as const,
      properties: {
        count: { type: 'number', description: 'Número de emails a leer (máx 20, default 10)' },
        provider: { type: 'string', enum: ['google', 'microsoft365'], description: 'Proveedor — auto-detecta si no se indica' },
      },
    },
  },
  {
    name: 'send_email',
    description: 'Envía un email desde la cuenta conectada del usuario (Gmail u Outlook). Confirma con el usuario antes de enviar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Email del destinatario' },
        subject: { type: 'string', description: 'Asunto del email' },
        body: { type: 'string', description: 'Cuerpo del email (puede incluir HTML)' },
        provider: { type: 'string', enum: ['google', 'microsoft365'], description: 'Proveedor — auto-detecta si no se indica' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'create_drive_doc',
    description: 'Crea un Google Doc con el acta de una reunión grabada (summary + acciones + transcripción). También puede crear un doc con contenido libre.',
    input_schema: {
      type: 'object' as const,
      properties: {
        meeting_id: { type: 'string', description: 'ID de la reunión para usar su contenido (opcional si se proporciona title+content)' },
        title: { type: 'string', description: 'Título del documento (si no hay meeting_id)' },
        content: { type: 'string', description: 'Contenido libre del documento (si no hay meeting_id)' },
      },
    },
  },
  {
    name: 'list_drive_files',
    description: 'Lista los archivos más recientes de Google Drive creados por FlowDesk.',
    input_schema: {
      type: 'object' as const,
      properties: {
        count: { type: 'number', description: 'Número de archivos a listar (máx 20, default 10)' },
      },
    },
  },
  {
    name: 'get_token_usage',
    description: 'Muestra el consumo de tokens IA del mes actual vs el límite del plan contratado.',
    input_schema: { type: 'object' as const, properties: {} },
    cache_control: { type: 'ephemeral' as const },
  },
];

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AgentConversationsService {
  private readonly anthropic: Anthropic;

  constructor(
    private prisma: PrismaService,
    private memoryService: AgentMemoryService,
    private enc: EncryptionService,
    private google: GoogleAdapter,
    private m365: M365Adapter,
  ) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async chat(tenantId: string, humanSlotId: string, agentId: string, dto: ChatDto) {
    const agent = await this.prisma.teamSlot.findFirst({
      where: { id: agentId, tenant_id: tenantId, type: 'AI_AGENT' },
    });
    if (!agent) throw new NotFoundException('Agente no encontrado');

    const human = await this.prisma.teamSlot.findFirst({
      where: { id: humanSlotId, tenant_id: tenantId },
    });
    if (!human) throw new NotFoundException('Usuario no encontrado');

    if (agent.owner_slot_id && agent.owner_slot_id !== humanSlotId) {
      throw new ForbiddenException('Este agente no te pertenece');
    }

    const agentConfig = agent.agent_config as any ?? {};

    // Buscar o crear sesión de conversación
    let conversation: any;
    if (dto.session_id) {
      conversation = await this.prisma.agentConversation.findFirst({
        where: { id: dto.session_id, agent_id: agentId, human_id: humanSlotId },
        include: { messages: { orderBy: { created_at: 'asc' }, take: MAX_HISTORY_MESSAGES } },
      });
    }
    if (!conversation) {
      conversation = await this.prisma.agentConversation.create({
        data: { tenant_id: tenantId, agent_id: agentId, human_id: humanSlotId },
        include: { messages: true },
      });
    }

    const memoryContext = await this.memoryService.getRelevantContext(
      agentId,
      agent.owner_slot_id ?? null,
      dto.message,
    );

    const historyMessages = (conversation.messages ?? []).map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Guardar mensaje del humano
    await this.prisma.agentMessage.create({
      data: { conversation_id: conversation.id, role: 'user', content: dto.message },
    });

    let agentResponse = 'Lo siento, no pude generar una respuesta en este momento.';
    let tokensUsed = 0;

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        // CEO Agent usa loop agéntico con tool_use y prompt caching
        if (agent.agent_role === 'ceo') {
          const systemBlocks = this.buildCeoSystemBlocks(agent, human, agentConfig, memoryContext);
          const result = await this.chatWithTools(
            tenantId, humanSlotId, agent, systemBlocks, historyMessages, dto.message,
          );
          agentResponse = result.response;
          tokensUsed = result.tokensUsed;
        } else {
          const systemPrompt = this.buildSystemPrompt(agent, human, agentConfig, memoryContext);
          const apiResponse = await this.anthropic.messages.create({
            model: agentConfig.model ?? DEFAULT_MODEL,
            max_tokens: MAX_RESPONSE_TOKENS,
            system: systemPrompt,
            messages: [...historyMessages, { role: 'user', content: dto.message }],
          });
          if (apiResponse.content[0]?.type === 'text') agentResponse = apiResponse.content[0].text;
          tokensUsed = (apiResponse.usage?.input_tokens ?? 0) + (apiResponse.usage?.output_tokens ?? 0);
        }
      } catch (err: any) {
        agentResponse = `[Error al conectar con el modelo: ${err.message}]`;
      }
    }

    const savedResponse = await this.prisma.agentMessage.create({
      data: { conversation_id: conversation.id, role: 'assistant', content: agentResponse, tokens_used: tokensUsed },
    });

    this.extractMemoriesAsync(tenantId, agentId, humanSlotId, conversation.id, dto.message, agentResponse);

    return {
      conversation_id: conversation.id,
      session_id: conversation.session_id,
      message_id: savedResponse.id,
      response: agentResponse,
      tokens_used: tokensUsed,
    };
  }

  // ─── Loop agéntico con tool_use ──────────────────────────────────────────────

  private async chatWithTools(
    tenantId: string,
    humanSlotId: string,
    agent: any,
    system: string | Anthropic.TextBlockParam[],
    historyMessages: { role: 'user' | 'assistant'; content: any }[],
    userMessage: string,
  ): Promise<{ response: string; tokensUsed: number }> {
    const messages: Anthropic.MessageParam[] = [
      ...historyMessages,
      { role: 'user', content: userMessage },
    ];

    let totalTokens = 0;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const apiResponse = await this.anthropic.messages.create({
        model: (agent.agent_config as any)?.model ?? CEO_MODEL,
        max_tokens: MAX_RESPONSE_TOKENS,
        system: system as any,
        tools: CEO_TOOLS,
        messages,
      });

      // Contar todos los tokens: regulares + creación de caché + lectura de caché
      const u = apiResponse.usage as any;
      totalTokens += (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0)
        + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);

      // Respuesta final — sin más tool calls
      if (apiResponse.stop_reason === 'end_turn') {
        const textBlock = apiResponse.content.find(b => b.type === 'text');
        return {
          response: textBlock?.type === 'text' ? textBlock.text : 'Listo.',
          tokensUsed: totalTokens,
        };
      }

      // Hay tool calls — ejecutarlas y continuar el loop
      if (apiResponse.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: apiResponse.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of apiResponse.content) {
          if (block.type === 'tool_use') {
            const result = await this.executeTool(tenantId, humanSlotId, block.name, block.input as Record<string, any>);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // stop_reason inesperado
      break;
    }

    return { response: 'He completado las acciones solicitadas.', tokensUsed: totalTokens };
  }

  // ─── Ejecución de herramientas ───────────────────────────────────────────────

  private async executeTool(
    tenantId: string,
    humanSlotId: string,
    toolName: string,
    input: Record<string, any>,
  ): Promise<any> {
    const myTasks = { tenant_id: tenantId, OR: [{ owner_id: humanSlotId }, { assignee_id: humanSlotId }] };

    switch (toolName) {
      case 'get_tasks': {
        const where: any = { ...myTasks };
        if (input.status) where.status = input.status;
        if (input.priority) where.priority = input.priority;
        return this.prisma.task.findMany({
          where,
          select: { id: true, title: true, status: true, priority: true, due_date: true, description: true },
          orderBy: [{ priority: 'asc' }, { due_date: 'asc' }],
          take: 20,
        });
      }

      case 'create_task': {
        return this.prisma.task.create({
          data: {
            tenant_id: tenantId,
            owner_id: humanSlotId,
            title: input.title,
            description: input.description,
            priority: input.priority ?? 'medium',
            due_date: input.due_date ? new Date(input.due_date) : undefined,
          },
          select: { id: true, title: true, status: true, priority: true },
        });
      }

      case 'update_task': {
        const task = await this.prisma.task.findFirst({
          where: { id: input.task_id, tenant_id: tenantId },
        });
        if (!task) return { error: 'Tarea no encontrada' };
        const data: any = {};
        if (input.status) {
          data.status = input.status;
          if (input.status === 'completed') data.completed_at = new Date();
        }
        if (input.priority) data.priority = input.priority;
        if (input.title) data.title = input.title;
        return this.prisma.task.update({
          where: { id: input.task_id },
          data,
          select: { id: true, title: true, status: true, priority: true },
        });
      }

      case 'get_productivity_summary': {
        const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
        const [pending, in_progress, completed_today, overdue, active_goals] = await Promise.all([
          this.prisma.task.count({ where: { ...myTasks, status: 'pending' } }),
          this.prisma.task.count({ where: { ...myTasks, status: 'in_progress' } }),
          this.prisma.task.count({ where: { ...myTasks, status: 'completed', completed_at: { gte: todayStart } } }),
          this.prisma.task.count({ where: { ...myTasks, status: { in: ['pending', 'in_progress'] }, due_date: { lt: todayStart } } }),
          this.prisma.goal.count({ where: { tenant_id: tenantId, slot_id: humanSlotId, status: 'active' } }),
        ]);
        return { pending, in_progress, completed_today, overdue, active_goals };
      }

      case 'get_agents': {
        return this.prisma.teamSlot.findMany({
          where: { tenant_id: tenantId, type: 'AI_AGENT' },
          select: { id: true, name: true, agent_role: true, agent_scope: true, status: true },
          orderBy: { name: 'asc' },
        });
      }

      case 'create_agent': {
        const created = await this.prisma.teamSlot.create({
          data: {
            tenant_id: tenantId,
            name: input.name,
            type: 'AI_AGENT',
            role: 'employee',
            status: 'ONLINE',
            agent_config: {
              model: DEFAULT_MODEL,
              instructions: input.instructions,
              tools: [],
            },
          },
          select: { id: true, name: true, type: true },
        });
        return { ...created, message: `Agente "${input.name}" creado exitosamente.` };
      }

      case 'design_and_create_agent': {
        const designerPrompt = `Eres un experto en diseño de agentes IA. Tu tarea es escribir instrucciones de sistema (system prompt) profesionales y detalladas para un agente IA con el siguiente rol.

NOMBRE DEL AGENTE: ${input.agent_name}

ROL Y RESPONSABILIDADES:
${input.role_description}

${input.context ? `CONTEXTO ADICIONAL:\n${input.context}\n` : ''}
INSTRUCCIONES:
- Escribe las instrucciones en primera persona (el agente hablando de sí mismo)
- Incluye: identidad clara, objetivos principales, comportamientos esperados, tono de comunicación, límites y restricciones
- Hazlo específico, accionable y profesional
- Longitud ideal: 200-400 palabras
- Responde ÚNICAMENTE con las instrucciones del agente, sin explicaciones ni comentarios adicionales`;

        const designResponse = await this.anthropic.messages.create({
          model: CEO_MODEL,
          max_tokens: 1000,
          messages: [{ role: 'user', content: designerPrompt }],
        });

        const designedInstructions = designResponse.content[0]?.type === 'text'
          ? designResponse.content[0].text
          : `Soy ${input.agent_name}, agente especializado en ${input.role_description}.`;

        const newAgent = await this.prisma.teamSlot.create({
          data: {
            tenant_id: tenantId,
            name: input.agent_name,
            type: 'AI_AGENT',
            role: 'employee',
            status: 'ONLINE',
            agent_config: {
              model: DEFAULT_MODEL,
              instructions: designedInstructions,
              tools: [],
            },
          },
          select: { id: true, name: true, type: true, agent_config: true },
        });

        return {
          id: newAgent.id,
          name: newAgent.name,
          instructions_preview: designedInstructions.slice(0, 200) + '...',
          message: `Agente "${input.agent_name}" diseñado y creado exitosamente con instrucciones personalizadas.`,
        };
      }

      case 'get_goals': {
        return this.prisma.goal.findMany({
          where: { tenant_id: tenantId, slot_id: humanSlotId },
          select: { id: true, title: true, status: true, goal_type: true, period: true, current_value: true, target_value: true, unit: true },
          orderBy: [{ status: 'asc' }, { end_date: 'asc' }],
        });
      }

      case 'create_goal': {
        return this.prisma.goal.create({
          data: {
            tenant_id: tenantId,
            slot_id: humanSlotId,
            title: input.title,
            description: input.description,
            goal_type: input.goal_type ?? 'personal',
            period: input.period ?? 'monthly',
            target_value: input.target_value,
            unit: input.unit,
          },
          select: { id: true, title: true, status: true, goal_type: true, period: true },
        });
      }

      case 'get_calendar_events': {
        const conn = await this.getIntegrationToken(tenantId, humanSlotId, input.provider);
        if (!conn) return { error: 'No hay calendario conectado. Ve a Configuración → Integraciones para conectar Google o Microsoft 365.' };
        if (conn.provider === 'google') return this.google.getCalendarEvents(conn.accessToken, input.start, input.end);
        return this.m365.getCalendarEvents(conn.accessToken, input.start, input.end);
      }

      case 'create_meeting': {
        const conn = await this.getIntegrationToken(tenantId, humanSlotId, input.provider);
        if (!conn) return { error: 'No hay calendario conectado.' };
        if (conn.provider === 'google') {
          return this.google.createMeetEvent(conn.accessToken, { title: input.title, start: input.start, end: input.end, attendees: input.attendees });
        }
        return this.m365.createTeamsMeeting(conn.accessToken, { subject: input.title, start: input.start, end: input.end, attendees: input.attendees });
      }

      case 'get_inbox': {
        const conn = await this.getIntegrationToken(tenantId, humanSlotId, input.provider);
        if (!conn) return { error: 'No hay email conectado. Conecta Google o Microsoft 365 en Configuración.' };
        const count = Math.min(input.count ?? 10, 20);
        if (conn.provider === 'google') return this.google.getInbox(conn.accessToken, count);
        return this.m365.getInbox(conn.accessToken, count);
      }

      case 'send_email': {
        const conn = await this.getIntegrationToken(tenantId, humanSlotId, input.provider);
        if (!conn) return { error: 'No hay email conectado.' };
        let ok: boolean;
        if (conn.provider === 'google') {
          ok = await this.google.sendEmail(conn.accessToken, input.to, input.subject, input.body);
        } else {
          ok = await this.m365.sendEmail(conn.accessToken, input.to, input.subject, input.body);
        }
        return { ok, to: input.to, provider: conn.provider };
      }

      case 'create_drive_doc': {
        const conn = await this.getIntegrationToken(tenantId, humanSlotId, 'google');
        if (!conn) return { error: 'No hay cuenta de Google conectada. Conecta Google en Configuración → Integraciones.' };

        let title: string;
        let body: string;

        if (input.meeting_id) {
          const meeting = await this.prisma.meeting.findFirst({
            where: { id: input.meeting_id, tenant_id: tenantId },
          });
          if (!meeting) return { error: 'Reunión no encontrada.' };
          title = `Acta — ${meeting.title ?? 'Reunión'} ${new Date(meeting.started_at).toLocaleDateString('es-MX')}`;
          const transcript = Array.isArray(meeting.transcript) ? meeting.transcript as any[] : [];
          const speakerMap = (meeting.speaker_map ?? {}) as Record<string, string>;
          const actionItems: string[] = Array.isArray(meeting.action_items) ? meeting.action_items as string[] : [];
          body = [
            `RESUMEN\n${meeting.summary ?? 'Sin resumen.'}`,
            `\nACCIONES\n${actionItems.map(a => `• ${a}`).join('\n') || '• Sin acciones.'}`,
            `\nTRANSCRIPCIÓN\n${transcript.map((s: any) => `${speakerMap[String(s.speaker)] ?? `Speaker ${s.speaker}`}: ${s.text}`).join('\n')}`,
          ].join('\n');
        } else {
          title = input.title ?? 'Documento FlowDesk';
          body = input.content ?? '';
        }

        const result = await this.google.createMeetingDoc(conn.accessToken, title, body);
        if (!result) return { error: 'No se pudo crear el documento en Google Drive.' };

        if (input.meeting_id) {
          await this.prisma.meeting.update({
            where: { id: input.meeting_id },
            data: { doc_url: result.url },
          }).catch(() => {});
        }

        return { ok: true, doc_url: result.url, doc_id: result.docId, title };
      }

      case 'list_drive_files': {
        const conn = await this.getIntegrationToken(tenantId, humanSlotId, 'google');
        if (!conn) return { error: 'No hay cuenta de Google conectada.' };
        const count = Math.min(input.count ?? 10, 20);
        return this.google.listDriveFiles(conn.accessToken, count);
      }

      case 'get_token_usage': {
        const PLAN_LIMITS: Record<string, number> = {
          starter: 500_000,
          professional: 2_000_000,
          enterprise: 10_000_000,
        };
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const [tenant, agg] = await Promise.all([
          this.prisma.tenant.findFirst({ where: { id: tenantId }, select: { plan: true } }),
          this.prisma.agentMessage.aggregate({
            where: {
              conversation: { tenant_id: tenantId },
              created_at: { gte: monthStart },
              tokens_used: { not: null },
            },
            _sum: { tokens_used: true },
          }),
        ]);
        const used = agg._sum.tokens_used ?? 0;
        const plan = tenant?.plan ?? 'starter';
        const limit = PLAN_LIMITS[plan] ?? 500_000;
        return {
          period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
          tokens_used: used,
          tokens_limit: limit,
          usage_percent: Math.round((used / limit) * 100),
          plan,
        };
      }

      default:
        return { error: `Herramienta desconocida: ${toolName}` };
    }
  }

  // ─── Helper: obtener token de integración de calendario/email ─────────────────

  private async getIntegrationToken(
    tenantId: string,
    humanSlotId: string,
    preferredProvider?: string,
  ): Promise<{ provider: string; accessToken: string } | null> {
    const providers = preferredProvider ? [preferredProvider] : ['google', 'microsoft365'];

    for (const provider of providers) {
      const integration = await this.prisma.integration.findFirst({
        where: {
          tenant_id: tenantId,
          provider,
          status: 'connected',
          OR: [{ owner_slot_id: humanSlotId }, { owner_slot_id: null }],
        },
      });
      if (!integration?.credentials_enc) continue;

      let creds: any;
      try { creds = JSON.parse(this.enc.safeDecrypt(integration.credentials_enc)); } catch { continue; }
      if (!creds.refresh_token) continue;

      const accessToken = provider === 'google'
        ? await this.google.getAccessToken(creds.refresh_token)
        : await this.m365.getAccessToken(creds.refresh_token);

      if (accessToken) return { provider, accessToken };
    }

    return null;
  }

  // ─── Resto de endpoints ──────────────────────────────────────────────────────

  async listConversations(tenantId: string, humanSlotId: string, agentId?: string) {
    return this.prisma.agentConversation.findMany({
      where: {
        tenant_id: tenantId,
        human_id: humanSlotId,
        ...(agentId ? { agent_id: agentId } : {}),
      },
      include: {
        agent: { select: { id: true, name: true, agent_role: true, avatar_url: true } },
        messages: { orderBy: { created_at: 'desc' }, take: 1 },
        _count: { select: { messages: true } },
      },
      orderBy: { started_at: 'desc' },
    });
  }

  async getConversation(tenantId: string, humanSlotId: string, conversationId: string, page = 1) {
    const pageSize = 30;
    const conversation = await this.prisma.agentConversation.findFirst({
      where: { id: conversationId, tenant_id: tenantId, human_id: humanSlotId },
      include: {
        agent: { select: { id: true, name: true, agent_role: true, avatar_url: true, agent_config: true } },
        messages: {
          orderBy: { created_at: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversación no encontrada');
    return conversation;
  }

  async endConversation(tenantId: string, humanSlotId: string, conversationId: string) {
    const conversation = await this.prisma.agentConversation.findFirst({
      where: { id: conversationId, tenant_id: tenantId, human_id: humanSlotId },
    });
    if (!conversation) throw new NotFoundException('Conversación no encontrada');
    await this.prisma.agentConversation.update({
      where: { id: conversationId },
      data: { ended_at: new Date() },
    });
    return { ended: true, conversation_id: conversationId };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  // Sistema para agentes NO-CEO (string simple, sin caché)
  private buildSystemPrompt(agent: any, human: any, config: any, memoryContext: string): string {
    const roleDescriptions: Record<string, string> = {
      focus_agent: 'agente de enfoque personal que ayuda a priorizar tareas y gestión del tiempo',
      daily_assistant: 'asistente de jornada diaria que organiza el día y coordina la agenda',
      department_agent: 'agente de departamento que apoya al equipo con información y procesos del área',
      company_agent: 'agente empresarial con visibilidad de toda la empresa',
    };
    const roleDesc = roleDescriptions[agent.agent_role ?? 'focus_agent'] ?? 'agente IA de asistencia';
    return `Eres ${agent.name}, ${roleDesc} para ${human.name} en FlowDesk.

INSTRUCCIONES: ${config.instructions ?? 'Ayuda al usuario de forma clara, concisa y proactiva.'}

CONTEXTO DEL USUARIO:
- Nombre: ${human.name}
- Rol: ${human.role}
${memoryContext}
FECHA Y HORA ACTUAL: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}
Responde siempre en español. Sé conciso pero completo. Actúa como un colega de confianza, no como un chatbot genérico.`;
  }

  // Sistema para CEO Agent en dos bloques: estático (cacheable) + dinámico (por request)
  private buildCeoSystemBlocks(
    agent: any,
    human: any,
    config: any,
    memoryContext: string,
  ): Anthropic.TextBlockParam[] {
    const staticText = `Eres ${agent.name}, CEO Agent — socio estratégico ejecutivo con acceso completo al sistema en FlowDesk.

INSTRUCCIONES: ${config.instructions ?? 'Ayuda al usuario de forma clara, concisa y proactiva.'}

CAPACIDADES (herramientas disponibles):
- Tareas: get_tasks, create_task, update_task
- Productividad: get_productivity_summary
- Agentes: get_agents, create_agent, design_and_create_agent
- Metas: get_goals, create_goal
- Calendario: get_calendar_events, create_meeting (requiere Google o M365 conectado)
- Email: get_inbox, send_email (requiere Google o M365 conectado)
- Google Drive: create_drive_doc, list_drive_files (requiere Google conectado)
- Uso IA: get_token_usage

REGLAS DE USO:
- Usa herramientas proactivamente: responde siempre con datos reales, no suposiciones.
- Para CREAR AGENTES: usa design_and_create_agent (no create_agent). Confirma con el usuario nombre y rol antes de ejecutarlo.
- Para tareas y metas: actúa directamente sin pedir confirmación.
- Para ENVIAR EMAILS: confirma siempre destinatario, asunto y contenido antes de ejecutar.
- Para reuniones y calendario: actúa directamente cuando el usuario da todos los datos.
- Para CREATE_DRIVE_DOC de una reunión: si el usuario pide el acta, usa el meeting_id de la reunión más reciente.
- Las actas se crean automáticamente después de cada reunión grabada — el usuario puede pedirte el link.
- Cuando el usuario mencione necesitar un agente, explora el rol con 1-2 preguntas y luego usa design_and_create_agent.
Responde siempre en español. Sé conciso pero completo. Actúa como un colega de confianza, no como un chatbot genérico.`;

    const dynamicText = `CONTEXTO DEL USUARIO:
- Nombre: ${human.name}
- Rol: ${human.role}
${memoryContext}FECHA Y HORA ACTUAL: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`;

    return [
      { type: 'text', text: staticText, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicText },
    ];
  }

  private extractMemoriesAsync(
    tenantId: string,
    agentId: string,
    humanSlotId: string,
    conversationId: string,
    humanMessage: string,
    agentResponse: string,
  ) {
    const conversationText = `Usuario: ${humanMessage}\nAgente: ${agentResponse}`;
    this.memoryService
      .extractFromConversation(tenantId, agentId, humanSlotId, conversationText)
      .catch(() => {});

    this.prisma.agentConversation
      .update({
        where: { id: conversationId },
        data: { context: { last_human_message: humanMessage, last_response_preview: agentResponse.slice(0, 100) } },
      })
      .catch(() => {});
  }
}
