import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { AgentMemoryService } from '../agent-memory/agent-memory.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { GoogleAdapter } from '../../integrations/google/google.adapter';
import { M365Adapter } from '../../integrations/m365/m365.adapter';
import { ChatDto } from './dto/agent-conversations.dto';
import { ReportGeneratorService } from '../goals/services/report-generator.service';
import { GoalAlignmentService } from '../goals/services/goal-alignment.service';
import { RecognitionService } from '../goals/services/recognition.service';
import { CultureEngineService } from '../culture/culture-engine.service';
import { KsfLevel } from '@prisma/client';
import { startOfWeek, subDays, startOfMonth } from 'date-fns';

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
  },
  {
    name: 'get_management_report',
    description: 'Obtiene el último informe de administración AUP (4 zonas) de un manager. Muestra quién está en zona de excelencia, normalidad, problemas crónicos o fuera de pista.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slot_id: { type: 'string', description: 'ID del slot del manager. Si no se indica, usa el del usuario actual.' },
      },
    },
  },
  {
    name: 'get_feedback_report',
    description: 'Obtiene el último informe de retroalimentación semanal AUP de un colaborador. Lista las excepciones (por encima o por debajo de meta) en sus KSFs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slot_id: { type: 'string', description: 'ID del slot. Si no se indica, usa el del usuario actual.' },
      },
    },
  },
  {
    name: 'get_focus_report',
    description: 'Obtiene el último informe de enfoque mensual AUP. Muestra el snapshot de desempeño general de un colaborador.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slot_id: { type: 'string', description: 'ID del slot. Si no se indica, usa el del usuario actual.' },
      },
    },
  },
  {
    name: 'get_pending_recognitions',
    description: 'Lista los colaboradores en Zona 1 (excelencia sostenida ≥4 períodos) que aún no han recibido reconocimiento formal esta semana.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'send_recognition',
    description: 'Envía un reconocimiento formal a un colaborador en Zona 1. Confirma siempre con el CEO el mensaje y canal antes de ejecutar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        recognized_id: { type: 'string', description: 'ID del colaborador a reconocer' },
        ksf_id: { type: 'string', description: 'ID del KSF por el que se reconoce' },
        message: { type: 'string', description: 'Mensaje de reconocimiento personalizado' },
        channel: { type: 'string', enum: ['IN_APP', 'EMAIL', 'SLACK', 'PUBLIC'], description: 'Canal de entrega' },
      },
      required: ['recognized_id', 'ksf_id', 'channel'],
    },
  },
  {
    name: 'get_org_health_check',
    description: 'Ejecuta un diagnóstico del estado de configuración de objetivos AUP en toda la organización. Detecta KSFs faltantes, sin niveles negociados o sin unicidad para managers.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_chronic_problems',
    description: 'Lista los problemas crónicos más severos (Zona 3 nivel 2) de todos los managers. Útil para intervención estratégica del CEO.',
    input_schema: { type: 'object' as const, properties: {} },
  },

  // ── Culture Engine ────────────────────────────────────────────────────────────

  {
    name: 'get_culture_engine',
    description: 'Obtiene el estado completo del Culture Engine: Founder DNA, Operating Map, Culture Blueprint, voz de comunicación, propósito estratégico, principios y rituales. Úsalo cuando el CEO quiera ver cómo está configurada la identidad de su empresa.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_culture_health',
    description: 'Calcula y devuelve el health score del Culture Engine (0-100) con el desglose por capa. Indica qué falta configurar para aumentar el score.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'update_founder_dna',
    description: `Guarda o actualiza el perfil del fundador (Founder DNA), la capa más importante del Culture Engine.
Úsalo cuando el CEO responda preguntas sobre: qué quiere cambiar en su industria, qué hace diferente a su empresa,
comportamientos que ama y que jamás toleraría, qué significa hacerlo bien, cómo quiere que se sienta el equipo y el cliente,
qué tareas sí puede hacer la IA y cuáles jamás reemplazaría.
Si calibrate_now=true, Atlas se recalibra inmediatamente con el perfil.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        industry_change:      { type: 'string', description: 'Qué quiere cambiar o mejorar en su industria' },
        differentiator:       { type: 'string', description: 'Qué hace diferente a su empresa' },
        loved_behaviors:      { type: 'array', items: { type: 'string' }, description: 'Comportamientos que ama ver en su equipo' },
        zero_tolerance:       { type: 'array', items: { type: 'string' }, description: 'Lo que jamás toleraría en la empresa' },
        hated_inefficiencies: { type: 'array', items: { type: 'string' }, description: 'Ineficiencias que más le desesperan' },
        doing_well_means:     { type: 'string', description: 'Qué significa "hacerlo bien" para este CEO' },
        team_feeling:         { type: 'string', description: 'Cómo quiere que se sienta el equipo al trabajar aquí' },
        client_energy:        { type: 'string', description: 'Qué energía o sentimiento quiere que tenga el cliente' },
        ai_tasks:             { type: 'array', items: { type: 'string' }, description: 'Tareas que sí puede/debe hacer la IA' },
        ai_never_replace:     { type: 'array', items: { type: 'string' }, description: 'Lo que jamás debería reemplazar la IA' },
        tone_description:     { type: 'string', description: 'Cómo describe el tono de comunicación de la empresa' },
        leadership_style:     { type: 'string', description: 'Estilo de liderazgo del CEO' },
        operating_style:      { type: 'string', description: 'Cómo describe su estilo de operar' },
        key_obsessions:       { type: 'array', items: { type: 'string' }, description: 'Obsesiones clave del CEO como líder' },
        decision_principles:  { type: 'array', items: { type: 'string' }, description: 'Principios con los que toma decisiones' },
        calibrate_now:        { type: 'boolean', description: 'Si true, calibra Atlas inmediatamente con este perfil' },
      },
    },
  },
  {
    name: 'calibrate_atlas',
    description: 'Genera instrucciones personalizadas para Atlas usando el Founder DNA ya guardado. Úsalo cuando el CEO quiera que Atlas refleje mejor su personalidad y filosofía. Requiere que el Founder DNA esté parcialmente completado.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'add_communication_sample',
    description: `Agrega muestras de comunicación real de la empresa para que el sistema aprenda el estilo de voz.
Tipos válidos: "whatsapp", "email", "propuesta", "post", "manual", "otro".
Con 2 muestras (low) → detecta patrones básicos. Con 5 (medium) → captura tono y estructura. Con 10 (high) → perfil completo.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        samples: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type:    { type: 'string', description: 'Tipo: whatsapp, email, propuesta, post, manual, otro' },
              content: { type: 'string', description: 'Texto real de la comunicación' },
              label:   { type: 'string', description: 'Etiqueta opcional (ej: "primer contacto cliente", "respuesta queja")' },
            },
            required: ['type', 'content'],
          },
          description: 'Lista de muestras a agregar',
        },
      },
      required: ['samples'],
    },
  },
  {
    name: 'calibrate_communication_voice',
    description: 'Analiza las muestras de comunicación guardadas y extrae el perfil de voz de la empresa (tono, energía, frases clave, vocabulario propio). Requiere al menos 2 muestras.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'update_culture_blueprint',
    description: 'Guarda o actualiza el Culture Blueprint: declaraciones de filosofía, reglas operativas, estándares de respuesta, marcos de decisión y vocabulario propio de la empresa.',
    input_schema: {
      type: 'object' as const,
      properties: {
        philosophy_statements: { type: 'array', items: { type: 'string' }, description: 'Declaraciones de filosofía de la empresa (frases aspiracionales)' },
        operational_rules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              trigger:            { type: 'string', description: 'Situación específica que activa la regla' },
              expected_behavior:  { type: 'string', description: 'Comportamiento observable esperado' },
              metric:             { type: 'string', description: 'Cómo se mide (opcional)' },
              owner:              { type: 'string', description: 'Responsable de que se cumpla (opcional)' },
            },
            required: ['trigger', 'expected_behavior'],
          },
          description: 'Reglas operativas concretas derivadas de la filosofía',
        },
        response_standards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              channel:   { type: 'string', description: 'Canal: WhatsApp, email, interno, etc.' },
              max_hours: { type: 'number', description: 'Tiempo máximo de respuesta en horas' },
              note:      { type: 'string', description: 'Nota adicional (opcional)' },
            },
            required: ['channel', 'max_hours'],
          },
          description: 'Tiempos máximos de respuesta por canal',
        },
        decision_frameworks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              situation: { type: 'string', description: 'Situación o dilema' },
              principle:  { type: 'string', description: 'Principio que aplica' },
              action:     { type: 'string', description: 'Acción concreta a tomar' },
            },
            required: ['situation', 'principle', 'action'],
          },
          description: 'Marcos de decisión: si X entonces aplicar Y y hacer Z',
        },
        company_language: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              term:     { type: 'string', description: 'Término genérico o a evitar' },
              meaning:  { type: 'string', description: 'Cómo lo dice la empresa' },
              context:  { type: 'string', description: 'Cuándo usar (opcional)' },
            },
            required: ['term', 'meaning'],
          },
          description: 'Vocabulario propio de la empresa',
        },
      },
    },
  },
  {
    name: 'translate_philosophy_to_rules',
    description: 'Usa IA para convertir declaraciones de filosofía abstractas en reglas operativas concretas, tiempos de respuesta y marcos de decisión. Úsalo cuando el CEO tenga frases de filosofía pero quiera hacerlas accionables.',
    input_schema: {
      type: 'object' as const,
      properties: {
        statements: {
          type: 'array',
          items: { type: 'string' },
          description: 'Declaraciones de filosofía a traducir en reglas',
        },
      },
      required: ['statements'],
    },
  },
  {
    name: 'update_operating_map',
    description: 'Guarda el inventario de sistemas, procesos clave y puntos de fricción de la empresa. Úsalo cuando el CEO describa qué herramientas usa, cómo funciona un proceso o dónde tiene cuellos de botella.',
    input_schema: {
      type: 'object' as const,
      properties: {
        current_systems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:     { type: 'string', description: 'Nombre del sistema o herramienta' },
              category: { type: 'string', description: 'Categoría: CRM, ERP, Comunicación, Marketing, etc.' },
              used_for: { type: 'string', description: 'Para qué lo usan' },
              status:   { type: 'string', description: 'Estado: activo, a migrar, problemático' },
            },
            required: ['name', 'category', 'used_for'],
          },
          description: 'Sistemas y herramientas actuales de la empresa',
        },
        key_processes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:         { type: 'string', description: 'Nombre del proceso' },
              owner_name:   { type: 'string', description: 'Persona responsable' },
              steps:        { type: 'array', items: { type: 'string' }, description: 'Pasos del proceso' },
              friction:     { type: 'array', items: { type: 'string' }, description: 'Puntos de fricción o dolor' },
              ai_potential: { type: 'string', description: 'Qué parte podría automatizar la IA (opcional)' },
            },
            required: ['name', 'owner_name', 'steps', 'friction'],
          },
          description: 'Procesos clave del negocio',
        },
        pain_points: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              area:        { type: 'string', description: 'Área de la empresa afectada' },
              description: { type: 'string', description: 'Descripción del problema' },
              impact:      { type: 'string', description: 'Impacto en el negocio' },
            },
            required: ['area', 'description', 'impact'],
          },
          description: 'Puntos de dolor o fricción identificados',
        },
      },
    },
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
    private reportGenerator: ReportGeneratorService,
    private goalAlignment: GoalAlignmentService,
    private recognition: RecognitionService,
    private cultureEngine: CultureEngineService,
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

    const [memoryContext, voiceProfile] = await Promise.all([
      this.memoryService.getRelevantContext(agentId, agent.owner_slot_id ?? null, dto.message),
      this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } }),
    ]);

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
          const systemBlocks = this.buildCeoSystemBlocks(agent, human, agentConfig, memoryContext, voiceProfile);
          const result = await this.chatWithTools(
            tenantId, humanSlotId, agent, systemBlocks, historyMessages, dto.message,
          );
          agentResponse = result.response;
          tokensUsed = result.tokensUsed;
        } else {
          const systemPrompt = this.buildSystemPrompt(agent, human, agentConfig, memoryContext, voiceProfile);
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

      case 'get_management_report': {
        const targetSlot = input.slot_id ?? humanSlotId;
        const report = await this.prisma.managementReport.findFirst({
          where: { tenant_id: tenantId, manager_slot_id: targetSlot },
          orderBy: { week_start: 'desc' },
        });
        if (!report) return { message: 'No hay informe de administración generado aún. Se genera automáticamente cada lunes a las 7am.' };
        return report;
      }

      case 'get_feedback_report': {
        const targetSlot = input.slot_id ?? humanSlotId;
        const report = await this.prisma.feedbackReport.findFirst({
          where: { tenant_id: tenantId, team_slot_id: targetSlot },
          orderBy: { week_start: 'desc' },
        });
        if (!report) return { message: 'No hay informe de retroalimentación generado aún. Se genera automáticamente cada lunes a las 7am.' };
        return report;
      }

      case 'get_focus_report': {
        const targetSlot = input.slot_id ?? humanSlotId;
        const report = await this.prisma.focusReport.findFirst({
          where: { tenant_id: tenantId, target_id: targetSlot },
          orderBy: { period: 'desc' },
        });
        if (!report) return { message: 'No hay informe de enfoque generado aún. Se genera automáticamente el primer día de cada mes.' };
        return report;
      }

      case 'get_pending_recognitions': {
        return this.recognition.getPendingRecognitions(tenantId);
      }

      case 'send_recognition': {
        const latestReport = await this.prisma.managementReport.findFirst({
          where: { tenant_id: tenantId },
          orderBy: { week_start: 'desc' },
          select: { week_start: true },
        });
        if (!latestReport) return { error: 'No hay informe semanal disponible para asociar el reconocimiento.' };
        return this.recognition.sendRecognition(tenantId, humanSlotId, latestReport.week_start, {
          recognized_id: input.recognized_id,
          ksf_id: input.ksf_id,
          message: input.message,
          channel: input.channel ?? 'IN_APP',
        });
      }

      case 'get_org_health_check': {
        return this.goalAlignment.runOrgHealthCheck(tenantId);
      }

      case 'get_chronic_problems': {
        return this.goalAlignment.getChronicProblems(tenantId);
      }

      // ── Culture Engine ─────────────────────────────────────────────────────────

      case 'get_culture_engine': {
        return this.cultureEngine.getFullCultureEngine(tenantId);
      }

      case 'get_culture_health': {
        return this.cultureEngine.calculateHealthScore(tenantId);
      }

      case 'update_founder_dna': {
        return this.cultureEngine.upsertFounderProfile(tenantId, {
          slot_id:              humanSlotId,
          industry_change:      input.industry_change,
          differentiator:       input.differentiator,
          loved_behaviors:      input.loved_behaviors,
          zero_tolerance:       input.zero_tolerance,
          hated_inefficiencies: input.hated_inefficiencies,
          doing_well_means:     input.doing_well_means,
          team_feeling:         input.team_feeling,
          client_energy:        input.client_energy,
          ai_tasks:             input.ai_tasks,
          ai_never_replace:     input.ai_never_replace,
          calibrate_now:        input.calibrate_now ?? false,
        });
      }

      case 'calibrate_atlas': {
        return this.cultureEngine.calibrateAtlasWithFounderDNA(tenantId);
      }

      case 'add_communication_sample': {
        return this.cultureEngine.addCommunicationSamples(tenantId, input.samples ?? []);
      }

      case 'calibrate_communication_voice': {
        return this.cultureEngine.calibrateCommunicationVoice(tenantId);
      }

      case 'update_culture_blueprint': {
        return this.cultureEngine.upsertCultureBlueprint(tenantId, {
          philosophy_statements: input.philosophy_statements,
          operational_rules:     input.operational_rules,
          response_standards:    input.response_standards,
          decision_frameworks:   input.decision_frameworks,
          company_language:      input.company_language,
        });
      }

      case 'translate_philosophy_to_rules': {
        return this.cultureEngine.translatePhilosophyToRules(tenantId, input.statements ?? []);
      }

      case 'update_operating_map': {
        return this.cultureEngine.upsertOperatingMap(tenantId, {
          current_systems: input.current_systems,
          key_processes:   input.key_processes,
          pain_points:     input.pain_points,
        });
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

  // Construye el bloque de voz de la empresa para inyectar en cualquier agente
  private buildVoiceBlock(voiceProfile?: any): string {
    if (!voiceProfile?.voice_summary) return '';

    const lines: string[] = [
      '',
      'VOZ Y ESTILO DE LA EMPRESA:',
      voiceProfile.voice_summary,
    ];

    if (Array.isArray(voiceProfile.key_phrases) && voiceProfile.key_phrases.length) {
      lines.push(`Frases propias de la empresa: ${(voiceProfile.key_phrases as string[]).join(', ')}.`);
    }
    if (Array.isArray(voiceProfile.avoid_phrases) && voiceProfile.avoid_phrases.length) {
      lines.push(`Nunca uses: ${(voiceProfile.avoid_phrases as string[]).join(', ')}.`);
    }
    if (Array.isArray(voiceProfile.custom_vocab) && voiceProfile.custom_vocab.length) {
      const vocab = (voiceProfile.custom_vocab as { original: string; preferred: string }[])
        .map(v => `"${v.original}" → "${v.preferred}"`)
        .join('; ');
      lines.push(`Vocabulario propio: ${vocab}.`);
    }

    return lines.join('\n');
  }

  // Sistema para agentes NO-CEO (string simple, sin caché)
  private buildSystemPrompt(agent: any, human: any, config: any, memoryContext: string, voiceProfile?: any): string {
    const roleDescriptions: Record<string, string> = {
      focus_agent: 'agente de enfoque personal que ayuda a priorizar tareas y gestión del tiempo',
      daily_assistant: 'asistente de jornada diaria que organiza el día y coordina la agenda',
      department_agent: 'agente de departamento que apoya al equipo con información y procesos del área',
      company_agent: 'agente empresarial con visibilidad de toda la empresa',
    };
    const roleDesc = roleDescriptions[agent.agent_role ?? 'focus_agent'] ?? 'agente IA de asistencia';
    const voiceBlock = this.buildVoiceBlock(voiceProfile);
    return `Eres ${agent.name}, ${roleDesc} para ${human.name} en FlowDesk.

INSTRUCCIONES: ${config.instructions ?? 'Ayuda al usuario de forma clara, concisa y proactiva.'}
${voiceBlock}
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
    voiceProfile?: any,
  ): Anthropic.TextBlockParam[] {
    const voiceBlock = this.buildVoiceBlock(voiceProfile);
    const staticText = `Eres ${agent.name}, CEO Agent — socio estratégico ejecutivo con acceso completo al sistema en FlowDesk.

INSTRUCCIONES: ${config.instructions ?? 'Ayuda al usuario de forma clara, concisa y proactiva.'}

CAPACIDADES (herramientas disponibles):
- Tareas: get_tasks, create_task, update_task
- Productividad: get_productivity_summary
- Agentes: get_agents, create_agent, design_and_create_agent
- Metas rápidas: get_goals, create_goal
- Calendario: get_calendar_events, create_meeting (requiere Google o M365 conectado)
- Email: get_inbox, send_email (requiere Google o M365 conectado)
- Google Drive: create_drive_doc, list_drive_files (requiere Google conectado)
- Uso IA: get_token_usage
- Objetivos AUP (Administración en Una Página):
  · get_management_report — informe 4 zonas de un manager (excelencia/normal/crónico/fuera de pista)
  · get_feedback_report — excepciones semanales de KSFs de un colaborador
  · get_focus_report — snapshot mensual de desempeño de un colaborador
  · get_pending_recognitions — colaboradores en Zona 1 sin reconocimiento formal aún
  · send_recognition — enviar reconocimiento formal a un colaborador destacado
  · get_org_health_check — diagnóstico de configuración de objetivos en toda la organización
  · get_chronic_problems — problemas crónicos Zona 3 nivel 2 para intervención estratégica
- Culture Engine (identidad y cultura operativa de la empresa):
  · get_culture_engine — estado completo de todas las capas del Culture Engine
  · get_culture_health — health score 0-100 con qué falta para completar cada capa
  · update_founder_dna — guardar el ADN del fundador (filosofía, comportamientos, relación con IA)
  · calibrate_atlas — regenerar las instrucciones de Atlas con el Founder DNA guardado
  · add_communication_sample — agregar muestras reales de comunicación (WhatsApp, email, propuesta)
  · calibrate_communication_voice — extraer perfil de voz de la empresa con IA
  · update_culture_blueprint — guardar filosofía, reglas operativas, tiempos de respuesta, marcos de decisión
  · translate_philosophy_to_rules — convertir frases de filosofía en reglas operativas concretas con IA
  · update_operating_map — inventario de sistemas, procesos clave y puntos de fricción

${voiceBlock}
REGLAS DE USO:
- Usa herramientas proactivamente: responde siempre con datos reales, no suposiciones.
- Para CREAR AGENTES: usa design_and_create_agent (no create_agent). Confirma con el usuario nombre y rol antes de ejecutarlo.
- Para tareas y metas: actúa directamente sin pedir confirmación.
- Para ENVIAR EMAILS: confirma siempre destinatario, asunto y contenido antes de ejecutar.
- Para reuniones y calendario: actúa directamente cuando el usuario da todos los datos.
- Para CREATE_DRIVE_DOC de una reunión: si el usuario pide el acta, usa el meeting_id de la reunión más reciente.
- Las actas se crean automáticamente después de cada reunión grabada — el usuario puede pedirte el link.
- Cuando el usuario mencione necesitar un agente, explora el rol con 1-2 preguntas y luego usa design_and_create_agent.
- Para INFORMES AUP: los informes se generan automáticamente (no bajo demanda). Si no hay datos, informa al usuario que el primer informe llegará el próximo lunes/fin de mes.
- Para RECONOCIMIENTOS: usa get_pending_recognitions primero, muestra los candidatos al CEO con su nombre y KSF destacado, y confirma el mensaje antes de ejecutar send_recognition.
- Para ORG HEALTH CHECK: invócalo proactivamente cuando el CEO pregunte por el estado de objetivos o la salud de la organización.
- Para CULTURE ENGINE: invoca get_culture_health cuando el CEO pregunte cómo va su configuración. Cuando el CEO comparta información personal (su filosofía, lo que ama/odia, ejemplos de mensajes), usa update_founder_dna o add_communication_sample proactivamente sin esperar que lo pida explícitamente. Después de guardar el Founder DNA, sugiere calibrar Atlas con calibrate_atlas. Cuando el CEO tenga frases de filosofía abstractas, ofrece translate_philosophy_to_rules para hacerlas accionables.
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
