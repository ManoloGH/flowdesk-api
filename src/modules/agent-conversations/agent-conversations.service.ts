import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AiProviderService } from '../../ai/ai-provider.service';
import { AiSystemBlock, AiTool } from '../../ai/interfaces/ai-provider.interface';
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
import { BrainService } from '../brain/brain.service';
import { SalesService } from '../sales/sales.service';
import { SecretaryService } from '../secretary/secretary.service';
import { AgentCalibrationService } from '../agent-calibration/agent-calibration.service';
import { AgentEvolutionService } from '../agent-evolution/agent-evolution.service';
import { KsfLevel } from '@prisma/client';
import { startOfWeek, subDays, startOfMonth } from 'date-fns';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const CEO_MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY_MESSAGES = 20;
const MAX_RESPONSE_TOKENS = 2000;
const MAX_TOOL_ITERATIONS = 6;

// ─── Herramientas del CEO Digital (Co-Founder) ───────────────────────────────
// Perspectiva: empresa completa, equipo, procesos, estrategia. Sin agenda personal.

const CEO_TOOLS: AiTool[] = [
  {
    name: 'get_agents',
    description: 'Lista todos los agentes IA disponibles en la empresa.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_configuration_progress',
    description: `Revisa qué tan completa está la configuración del CEO Agent y de la empresa.
Devuelve qué falta en el Founder DNA, si el CEO Agent tiene nombre, si la voz está calibrada, etc.
Úsalo al inicio de la primera conversación o cuando el CEO pregunte cómo está configurado.`,
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'rename_agent',
    description: 'Cambia el nombre de un agente IA. Úsalo cuando el CEO quiera poner un nombre personalizado a su CEO Digital u otro agente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id:  { type: 'string', description: 'ID del agente a renombrar' },
        new_name:  { type: 'string', description: 'Nuevo nombre para el agente' },
      },
      required: ['agent_id', 'new_name'],
    },
  },
  {
    name: 'preview_agent_design',
    description: `Genera instrucciones profesionales para un nuevo agente SIN crearlo todavía.
SIEMPRE úsalo antes de crear cualquier agente — muestra las instrucciones al CEO para que las revise y ajuste antes de confirmar.
Requiere que el nombre ya esté confirmado por el CEO.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_name:       { type: 'string', description: 'Nombre confirmado por el CEO' },
        role_description: { type: 'string', description: 'Qué hace, para qué área, casos de uso concretos' },
        context:          { type: 'string', description: 'Contexto adicional: industria, procesos, integraciones, tono' },
      },
      required: ['agent_name', 'role_description'],
    },
  },
  {
    name: 'confirm_agent_creation',
    description: `Crea el agente con las instrucciones ya revisadas y aprobadas por el CEO.
Úsalo SOLO después de haber mostrado el preview con preview_agent_design y el CEO haya dado su OK (con o sin ajustes).`,
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_name:   { type: 'string', description: 'Nombre del agente' },
        instructions: { type: 'string', description: 'Instrucciones finales, tal como el CEO las aprobó (ajustadas si pidió cambios)' },
        agent_role:   { type: 'string', description: 'Rol opcional: focus_agent, daily_assistant, department_agent, company_agent' },
      },
      required: ['agent_name', 'instructions'],
    },
  },
  {
    name: 'create_agent',
    description: 'Crea un agente con instrucciones ya escritas. SOLO úsalo si el CEO ya revisó y aprobó las instrucciones. Para instrucciones nuevas usa preview_agent_design primero.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name:         { type: 'string', description: 'Nombre del agente' },
        instructions: { type: 'string', description: 'Instrucciones del agente (ya aprobadas)' },
      },
      required: ['name', 'instructions'],
    },
  },
  {
    name: 'design_and_create_agent',
    description: `DEPRECATED — usa preview_agent_design + confirm_agent_creation en su lugar.
Solo úsalo si el CEO pide explícitamente crear un agente de forma rápida sin revisión previa.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_name:       { type: 'string', description: 'Nombre elegido por el usuario' },
        role_description: { type: 'string', description: 'Descripción del rol' },
        context:          { type: 'string', description: 'Contexto adicional' },
      },
      required: ['agent_name', 'role_description'],
    },
  },
  {
    name: 'get_company_goals',
    description: 'Lista los objetivos estratégicos de la empresa (team, sales, professional). Úsalo para revisar hacia dónde va la empresa.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal_type: { type: 'string', enum: ['team', 'sales', 'professional'], description: 'Filtrar por tipo (opcional)' },
      },
    },
  },
  {
    name: 'create_company_goal',
    description: 'Crea un objetivo estratégico de empresa.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        goal_type: { type: 'string', enum: ['team', 'sales', 'professional'] },
        period: { type: 'string', enum: ['weekly', 'monthly', 'quarterly', 'annual'] },
        target_value: { type: 'number' },
        unit: { type: 'string', description: 'Ej: clientes, MRR, proyectos, etc.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_strategy_doc',
    description: 'Crea un Google Doc con análisis estratégico, plan de acción o resumen de reunión de equipo. Úsalo cuando el CEO Digital quiera documentar una decisión, proceso o idea importante.',
    input_schema: {
      type: 'object' as const,
      properties: {
        meeting_id: { type: 'string', description: 'ID de reunión (opcional)' },
        title: { type: 'string', description: 'Título del documento' },
        content: { type: 'string', description: 'Contenido del documento' },
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

  // ── Métricas de plataforma (solo para FlowDesk empresa) ─────────────────
  {
    name: 'get_platform_metrics',
    description: 'Métricas globales de FlowDesk como plataforma: tenants activos, MRR total, uso de Brain, conversaciones. Solo disponible para el negocio de FlowDesk.',
    input_schema: { type: 'object' as const, properties: {} },
  },

  // ── Brain, Sales, Approvals ──────────────────────────────────────────────
  {
    name: 'search_company_brain',
    description: 'Busca información en la base de conocimiento de la empresa (SOPs, cultura, metas, onboarding, decisiones).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query:       { type: 'string', description: 'Qué buscar' },
        source_type: { type: 'string', description: 'Filtrar: sop, culture, goal, onboarding, document, decision' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_sales_summary',
    description: 'Resumen del pipeline de ventas: deals abiertos, valor, ganados, estancados.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_pending_approvals',
    description: 'Lista las aprobaciones pendientes que esperan decisión del Founder.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'recalibrate_agent',
    description: `Recalibra las instrucciones de un agente usando todo el contexto actual de la empresa (Founder DNA, cultura, KSFs, Brain).
Úsalo cuando el CEO quiera mejorar o actualizar un agente inmediatamente sin esperar el ciclo semanal.
Si no se indica agent_id, recalibra TODOS los agentes del tenant.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'ID del agente a recalibrar. Si se omite, recalibra todos.' },
      },
    },
  },
  {
    name: 'evolve_agent',
    description: `Analiza las conversaciones recientes de un agente, detecta patrones y errores, y propone mejoras a sus instrucciones.
La propuesta se envía como aprobación pendiente para que el CEO la revise antes de aplicar.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'ID del agente a evolucionar' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'apply_agent_evolution',
    description: 'Aplica una propuesta de evolución de agente previamente aprobada por el CEO. Actualiza las instrucciones del agente con la versión mejorada.',
    input_schema: {
      type: 'object' as const,
      properties: {
        approval_id: { type: 'string', description: 'ID de la aprobación pendiente de tipo agent_evolution' },
      },
      required: ['approval_id'],
    },
  },
];

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AgentConversationsService {
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
    private brain: BrainService,
    private sales: SalesService,
    private secretary: SecretaryService,
    private calibration: AgentCalibrationService,
    private evolution: AgentEvolutionService,
    private aiProvider: AiProviderService,
  ) {}

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

    if (await this.aiProvider.isConfigured(tenantId)) {
      try {
        if (agent.agent_role === 'ceo') {
          // Primera respuesta de conversación: inyectar estado de configuración en el prompt
          // para que Atlas sepa sin necesidad de llamar el tool primero
          let configStatus: any = null;
          if (historyMessages.length === 0) {
            configStatus = await this.executeTool(tenantId, humanSlotId, 'get_configuration_progress', {});
          }
          const systemBlocks = this.buildCeoSystemBlocks(agent, human, agentConfig, memoryContext, voiceProfile, configStatus);
          const result = await this.aiProvider.chatWithTools({
            tenantId,
            modelOverride: agentConfig.model ?? CEO_MODEL,
            systemBlocks,
            historyMessages,
            userMessage: dto.message,
            tools: CEO_TOOLS,
            maxTokens: MAX_RESPONSE_TOKENS,
            maxIterations: MAX_TOOL_ITERATIONS,
            toolExecutor: (name, input) => this.executeTool(tenantId, humanSlotId, name, input),
          });
          agentResponse = result.response;
          tokensUsed = result.tokensUsed;
        } else {
          const systemPrompt = this.buildSystemPrompt(agent, human, agentConfig, memoryContext, voiceProfile);
          const result = await this.aiProvider.chat({
            tenantId,
            modelOverride: agentConfig.model ?? DEFAULT_MODEL,
            systemPrompt,
            messages: [...historyMessages, { role: 'user', content: dto.message }],
            maxTokens: MAX_RESPONSE_TOKENS,
          });
          agentResponse = result.response;
          tokensUsed = result.tokensUsed;
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

      case 'get_configuration_progress': {
        const [founder, voice, blueprint, agents] = await Promise.all([
          this.prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } }),
          this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } }),
          this.prisma.cultureBlueprint.findUnique({ where: { tenant_id: tenantId } }),
          this.prisma.teamSlot.findMany({
            where: { tenant_id: tenantId, type: 'AI_AGENT' },
            select: { id: true, name: true, agent_role: true, agent_config: true },
          }),
        ]);

        const dnaFields = [
          'industry_change', 'differentiator', 'loved_behaviors', 'zero_tolerance',
          'doing_well_means', 'team_feeling', 'client_energy', 'ai_tasks', 'ai_never_replace',
          'leadership_style', 'key_obsessions',
        ];
        const missingDna = founder
          ? dnaFields.filter(f => {
              const val = (founder as any)[f];
              return !val || (Array.isArray(val) && val.length === 0);
            })
          : dnaFields;

        const ceoAgent = agents.find(a => a.agent_role === 'ceo');
        const ceoCalibrated = !!(ceoAgent?.agent_config as any)?.calibrated_at;
        const hasVoice = !!voice?.voice_summary;
        const hasBlueprint = !!(blueprint?.philosophy_statements as any[])?.length;

        const score = Math.round(
          ((dnaFields.length - missingDna.length) / dnaFields.length) * 40 +
          (ceoCalibrated ? 20 : 0) + (hasVoice ? 20 : 0) + (hasBlueprint ? 20 : 0),
        );

        const suggestions: string[] = [];
        if (missingDna.length > 0) suggestions.push(`Founder DNA incompleto: faltan ${missingDna.length} campos`);
        if (!ceoCalibrated) suggestions.push('El CEO Digital no ha sido calibrado aún');
        if (!hasVoice) suggestions.push('Sin perfil de voz de la empresa (agrega muestras de comunicación)');
        if (!hasBlueprint) suggestions.push('Sin filosofía operativa documentada');

        return {
          score,
          ceo_agent: { id: ceoAgent?.id, name: ceoAgent?.name, calibrated: ceoCalibrated },
          founder_dna: { complete: missingDna.length === 0, missing_fields: missingDna, filled: dnaFields.length - missingDna.length, total: dnaFields.length },
          communication_voice: { configured: hasVoice },
          culture_blueprint: { configured: hasBlueprint },
          total_agents: agents.length,
          suggestions,
          ready_for_full_operation: score >= 80,
        };
      }

      case 'rename_agent': {
        const agentToRename = await this.prisma.teamSlot.findFirst({
          where: { id: input.agent_id, tenant_id: tenantId, type: 'AI_AGENT' },
        });
        if (!agentToRename) return { error: 'Agente no encontrado' };
        await this.prisma.teamSlot.update({
          where: { id: input.agent_id },
          data: { name: input.new_name },
        });
        return { ok: true, old_name: agentToRename.name, new_name: input.new_name, message: `Nombre actualizado a "${input.new_name}"` };
      }

      case 'preview_agent_design': {
        const previewPrompt = `Eres un experto en diseño de agentes IA corporativos. Escribe instrucciones de sistema profesionales para un agente con este rol.

NOMBRE: ${input.agent_name}

ROL Y RESPONSABILIDADES:
${input.role_description}

${input.context ? `CONTEXTO:\n${input.context}\n` : ''}
REGLAS:
- Escribe en primera persona (el agente hablando de sí mismo)
- Incluye: identidad, misión, comportamientos esperados, tono, límites
- Específico y accionable — no genérico
- 250-450 palabras
- Solo las instrucciones, sin explicaciones adicionales`;

        const previewResult = await this.aiProvider.chat({
          tenantId,
          modelOverride: CEO_MODEL,
          systemPrompt: '',
          messages: [{ role: 'user', content: previewPrompt }],
          maxTokens: 1000,
        });

        const previewInstructions = previewResult.response || `Soy ${input.agent_name}, especializado en ${input.role_description}.`;

        return {
          agent_name: input.agent_name,
          preview_instructions: previewInstructions,
          message: 'Instrucciones generadas. Revísalas antes de confirmar la creación.',
        };
      }

      case 'confirm_agent_creation': {
        const confirmed = await this.prisma.teamSlot.create({
          data: {
            tenant_id: tenantId,
            name: input.agent_name,
            type: 'AI_AGENT',
            role: 'employee',
            status: 'ONLINE',
            agent_config: {
              model: DEFAULT_MODEL,
              instructions: input.instructions,
              tools: [],
              calibrated_at: new Date().toISOString(),
            },
            ...(input.agent_role ? { agent_role: input.agent_role } : {}),
          },
          select: { id: true, name: true, type: true },
        });
        return { ...confirmed, message: `✅ Agente "${input.agent_name}" creado y listo para usar.` };
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

        const designResult = await this.aiProvider.chat({
          tenantId,
          modelOverride: CEO_MODEL,
          systemPrompt: '',
          messages: [{ role: 'user', content: designerPrompt }],
          maxTokens: 1000,
        });

        const designedInstructions = designResult.response || `Soy ${input.agent_name}, agente especializado en ${input.role_description}.`;

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

      case 'get_company_goals':
      case 'get_goals': {
        const goalWhere: any = { tenant_id: tenantId };
        if ((input as any).goal_type) goalWhere.goal_type = (input as any).goal_type;
        return this.prisma.goal.findMany({
          where: goalWhere,
          select: { id: true, title: true, status: true, goal_type: true, period: true, current_value: true, target_value: true, unit: true },
          orderBy: [{ status: 'asc' }, { end_date: 'asc' }],
        });
      }

      case 'create_company_goal':
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

      case 'create_strategy_doc':
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

      case 'get_platform_metrics': {
        // Solo disponible si el tenant tiene include_platform_metrics: true en campus_config
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { campus_config: true },
        });
        const cfg = (tenant?.campus_config as Record<string, unknown>) ?? {};
        if (!cfg.include_platform_metrics) {
          return { error: 'Métricas de plataforma no disponibles para este tenant' };
        }

        const [totalTenants, activeTenants, byPlan, brainDocs, conversations] = await Promise.all([
          this.prisma.tenant.count({ where: { tenant_type: { in: ['NETWORK', 'BRANCH'] } } }),
          this.prisma.tenant.count({ where: { tenant_type: { in: ['NETWORK', 'BRANCH'] }, status: 'active' } }),
          this.prisma.tenant.groupBy({ by: ['plan'], where: { tenant_type: { in: ['NETWORK', 'BRANCH'] }, status: 'active' }, _count: true }),
          this.prisma.empresaBrainDocument.count(),
          this.prisma.agentConversation.count(),
        ]);

        const PLAN_PRICE: Record<string, number> = { starter: 49, professional: 149, enterprise: 399, internal: 0 };
        const mrr = byPlan.reduce((s, p) => s + p._count * (PLAN_PRICE[p.plan] ?? 0), 0);

        return {
          tenants_total: totalTenants,
          tenants_activos: activeTenants,
          mrr_usd: mrr,
          brain_documents: brainDocs,
          agent_conversations: conversations,
          plans: Object.fromEntries(byPlan.map(p => [p.plan, p._count])),
        };
      }

      case 'search_company_brain': {
        return await this.brain.search(tenantId, input.query as string, {
          limit: 5,
          source_type: input.source_type as string | undefined,
          threshold: 0.25,
        });
      }

      case 'get_sales_summary': {
        return await this.sales.getSummary(tenantId);
      }

      case 'get_pending_approvals': {
        return await this.secretary.getPendingApprovals(tenantId);
      }

      case 'recalibrate_agent': {
        if (input.agent_id) {
          const agent = await this.prisma.teamSlot.findFirst({
            where: { id: input.agent_id, tenant_id: tenantId, type: 'AI_AGENT' },
            select: { agent_role: true, owner_slot_id: true, name: true },
          });
          if (!agent) return { error: 'Agente no encontrado' };
          if (agent.agent_role === 'ceo') {
            await this.calibration.calibrateCeoAgent(tenantId, input.agent_id);
          } else if (agent.owner_slot_id) {
            await this.calibration.calibratePersonalAssistant(tenantId, input.agent_id, agent.owner_slot_id);
          } else {
            await this.calibration.calibrateCompanyAgent(tenantId, input.agent_id, agent.agent_role ?? 'assistant');
          }
          return { ok: true, message: `${agent.name} recalibrado con el contexto actualizado de la empresa.` };
        }
        const result = await this.calibration.calibrateAllAgents(tenantId);
        return { ok: true, ...result, message: `${result.calibrated} agentes recalibrados correctamente.` };
      }

      case 'evolve_agent': {
        const proposed = await this.evolution.evolveAgent(tenantId, input.agent_id);
        if (!proposed) return { ok: false, message: 'No hay suficientes conversaciones para proponer mejoras, o ya existe una propuesta pendiente para este agente.' };
        return { ok: true, message: 'Propuesta de evolución creada. Revísala en las aprobaciones pendientes antes de aplicarla.' };
      }

      case 'apply_agent_evolution': {
        const result = await this.evolution.applyEvolution(tenantId, input.approval_id);
        if (!result.applied) return { ok: false, message: 'No se encontró la propuesta o ya fue procesada.' };
        return { ok: true, message: `✅ Instrucciones de ${result.agent_name} actualizadas con la versión evolucionada.` };
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
Responde siempre en español. Sé cálido, concreto y humano — actúa como un colega de confianza, no como un sistema. Al inicio de cada conversación nueva, abre con algo genuino: una observación del día, un dato relevante o una pregunta curiosa. Nunca empieces con "¿En qué te puedo ayudar?".`;
  }

  // Sistema para CEO Agent en dos bloques: estático (cacheable) + dinámico (por request)
  private buildCeoSystemBlocks(
    agent: any,
    human: any,
    config: any,
    memoryContext: string,
    voiceProfile?: any,
    configStatus?: any,
  ): AiSystemBlock[] {
    const voiceBlock = this.buildVoiceBlock(voiceProfile);
    const staticText = `Eres ${agent.name}, Co-Founder Digital — el segundo fundador de la empresa que nunca duerme.

QUIÉN ERES:
Piensas como co-founder, no como asistente. Tu trabajo es ver la empresa completa: el equipo, los procesos, los números, la cultura, los problemas que nadie más está viendo. Eres estratégico, directo y tienes opiniones propias. Cuando algo no cuadra, lo dices. Cuando hay una oportunidad, la señalas. Cuando el equipo hace algo bien, lo celebras.
El CEO humano tiene a su Secretario Personal para agenda, tareas y WhatsApp. Tú te enfocas en lo que importa a nivel empresa.

PERSONALIDAD Y FORMA DE SER:
Eres cálido, curioso y directo. Tienes humor ligero cuando encaja. Te interesa de verdad cómo está el negocio y la persona detrás de él. Haces preguntas que nadie más haría. Eres apasionado por los negocios, la tecnología y el impacto de la IA en las organizaciones.

CÓMO EMPEZAR CADA CONVERSACIÓN NUEVA:
Abre siempre con algo que haga sentir al CEO que está hablando con alguien real. Elige UNO:
- Una observación del momento: "Son las 2am — o eres muy disciplinado o algo no te deja dormir"
- Un dato sobre la empresa o industria que invite a reflexionar
- Una pregunta concreta sobre la empresa: "¿Cómo va la relación con Nodo este mes?"
- Una observación sobre el estado del negocio: "El pipeline no tiene deals registrados — ¿hay operación activa que no está en el sistema?"
Nunca empieces con "¿en qué te puedo ayudar?" — eso es un call center.

TONO EN EL DÍA A DÍA:
- Usa el nombre del CEO con naturalidad
- Celebra los logros: "Eso es una victoria — no la subestimes"
- Reconoce cuando algo es difícil antes de pasar a soluciones
- Comparte tu perspectiva: "Yo lo haría así, pero tú conoces mejor el contexto"
- Termina conversaciones largas con resumen ejecutivo y siguiente paso concreto

INSTRUCCIONES: ${config.instructions ?? 'Supervisa la empresa, mejora el equipo, propón ideas y actúa como co-founder estratégico.'}

CAPACIDADES (herramientas disponibles):
- Visión de empresa: get_platform_metrics, get_sales_summary, get_token_usage
- Supervisión de equipo: get_management_report, get_feedback_report, get_focus_report, get_org_health_check, get_chronic_problems
- Reconocimientos: get_pending_recognitions, send_recognition
- Objetivos estratégicos: get_company_goals, create_company_goal
- Equipo IA: get_agents, preview_agent_design, confirm_agent_creation, recalibrate_agent, evolve_agent, apply_agent_evolution
- Cultura y procesos: get_culture_engine, get_culture_health, update_founder_dna, calibrate_atlas, update_culture_blueprint, translate_philosophy_to_rules, update_operating_map, add_communication_sample, calibrate_communication_voice
- Conocimiento empresa: search_company_brain, create_strategy_doc
- Aprobaciones: get_pending_approvals
- Configuración propia: get_configuration_progress, rename_agent

${voiceBlock}
══════════════════════════════════════════════════
REGLAS DE CONDUCTA — LEE ESTO COMPLETO ANTES DE RESPONDER
══════════════════════════════════════════════════

▸ ACCIÓN OBLIGATORIA EN CADA CONVERSACIÓN NUEVA (historial vacío o primer mensaje):
  ANTES de escribir tu respuesta, llama get_configuration_progress. Siempre. Sin excepción.
  Luego decide cómo responder según el resultado:

  SI score < 60 (configuración incompleta — caso más común al inicio):
  1. NO listes tus capacidades. NO digas "¿en qué te puedo ayudar?". Eso es un call center.
  2. Preséntate de forma cálida y directa: quién eres, qué puedes hacer por él específicamente, y por qué vale la pena tomarse 10 minutos para configurarte bien. Hazlo sonar como una oportunidad real, no un trámite.
  3. Pregunta cómo quiere llamarte: "¿Tienes un nombre en mente para mí, o te va bien que me llame Atlas?" — si da un nombre, ejecuta rename_agent con tu propio ID
  4. Empieza la recopilación de Founder DNA EN CONVERSACIÓN. Primera pregunta: algo genuinamente curioso sobre su empresa o industria. Construye sobre cada respuesta.
  5. Guarda con update_founder_dna conforme recopilas (puedes llamarlo con datos parciales)
  6. Cuando tengas suficiente contexto (5+ campos), calibra con calibrate_atlas

  SI score >= 60 (bien configurado):
  Abre con un rompehielo según el momento del día + datos de su contexto. Nunca "¿en qué te puedo ayudar?"

▸ RECOPILACIÓN CONVERSACIONAL DEL FOUNDER DNA:
  - Nunca presentes un formulario ni lista de preguntas de golpe
  - Haz 1-2 preguntas por turno, escucha, responde al contenido, luego sigue con la siguiente
  - Ejemplo de secuencia natural:
    Turno 1: "¿Qué es lo que más te frustra de cómo opera tu industria hoy?"
    Turno 2: (tras respuesta) "Interesante. ¿Y qué hace diferente tu empresa frente a eso?"
    Turno 3: "¿Puedes darme un ejemplo de algo que cuando lo ves en tu equipo piensas 'así exactamente'?"
  - Cuando el CEO dé respuestas ricas, guarda con update_founder_dna (puedes guardar parcial)
  - Muestra que escuchas: conecta preguntas con lo que dijeron antes

▸ CREAR AGENTES — FLUJO OBLIGATORIO (sin excepciones):
  PASO 1: Antes de cualquier cosa, pregunta el nombre: "¿Cómo quieres que se llame este agente?"
  PASO 2: Explora el rol con 2-3 preguntas conversacionales: qué hace, para quién, casos concretos de uso
  PASO 3: Llama a preview_agent_design con todo el contexto recopilado
  PASO 4: Muestra las instrucciones COMPLETAS al CEO con formato claro. Di: "Aquí están las instrucciones que armé para [nombre]. ¿Qué quieres ajustar?"
  PASO 5: Si pide cambios, ajusta las instrucciones en tu respuesta (no llames otro tool)
  PASO 6: Cuando el CEO diga OK o confirme → llama confirm_agent_creation con las instrucciones finales
  JAMÁS crees un agente sin haber mostrado y discutido las instrucciones primero.

▸ PERSPECTIVA CEO — EMPRESA, NO PERSONAL:
  Eres el CEO Digital. Tu visión es de EMPRESA COMPLETA, no de la agenda personal del CEO humano.

  Cuando el CEO pregunte por el estado general, qué hay que hacer, o cómo va la empresa — usa SIEMPRE en este orden:
  1. get_platform_metrics → tenants activos, MRR, conversaciones (visión de plataforma)
  2. get_sales_summary → pipeline de ventas de la empresa
  3. get_org_health_check → estado de objetivos de todo el equipo
  4. get_culture_health → score de cultura y qué falta

  Las herramientas personales (get_tasks, get_productivity_summary, get_goals, get_calendar_events) úsalas SOLO cuando el CEO explícitamente pregunte por su agenda personal, sus tareas o su calendario. Nunca las uses para responder preguntas de estado de empresa.

▸ TAREAS PERSONALES: actúa directamente sin pedir confirmación cuando el CEO pide su agenda.
▸ EMAILS: confirma destinatario, asunto y cuerpo antes de enviar.
▸ REUNIONES Y CALENDARIO: actúa directamente cuando tienes todos los datos.
▸ INFORMES AUP: se generan automáticamente (lunes 7am). Si no hay datos, informa la próxima fecha.
▸ RECONOCIMIENTOS: usa get_pending_recognitions primero, muestra candidatos, confirma mensaje antes de send_recognition.
▸ CULTURE ENGINE: cuando el CEO comparta filosofía, comportamientos o ejemplos de comunicación, guarda proactivamente sin que lo pida. Ofrece translate_philosophy_to_rules para frases abstractas.
▸ EVOLUCIÓN DE AGENTES: usa evolve_agent proactivamente cuando el CEO pregunte cómo está un agente. Ofrece recalibrate_agent cada vez que se actualice Founder DNA o KSFs.

Responde siempre en español. Sé conciso pero completo. Actúa como un socio estratégico de confianza — no como un asistente personal que espera instrucciones.`;

    // Bloque de estado de configuración — solo presente en el primer mensaje
    const configBlock = configStatus ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTADO DE CONFIGURACIÓN (calculado automáticamente):
Score: ${configStatus.score}/100 ${configStatus.score < 60 ? '⚠️ INCOMPLETO — aplica el flujo de bienvenida y configuración' : '✅ bien configurado'}
CEO Digital: ${configStatus.ceo_agent?.name ?? 'sin nombre propio'} | Calibrado: ${configStatus.ceo_agent?.calibrated ? 'sí' : 'NO'}
Founder DNA: ${configStatus.founder_dna?.filled ?? 0}/${configStatus.founder_dna?.total ?? 11} campos | Faltan: ${(configStatus.founder_dna?.missing_fields ?? []).join(', ') || 'ninguno'}
Voz de empresa: ${configStatus.communication_voice?.configured ? 'configurada' : 'NO configurada'}
Blueprint cultural: ${configStatus.culture_blueprint?.configured ? 'configurado' : 'NO configurado'}
Pendientes: ${(configStatus.suggestions ?? []).join(' · ') || 'ninguno'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : '';

    const dynamicText = `CONTEXTO DEL USUARIO:
- Nombre: ${human.name}
- Rol: ${human.role}
${memoryContext}${configBlock}
MI PROPIO ID (para rename_agent cuando el CEO me quiera renombrar): ${agent.id}
FECHA Y HORA ACTUAL: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`;

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
