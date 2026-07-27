import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';

// ─── tipos ────────────────────────────────────────────────────────────────────

interface HandleParams {
  phone: string;
  jid: string;
  message: string;
  contactName?: string;
  tenantId: string;
  instanceName: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// ─── tools definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'callWebhook',
      description:
        'Llama a un webhook externo configurado para este skill. Usar cuando el skill de tipo webhook deba activarse según su condición de disparo.',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Nombre exacto del skill que se está activando' },
        },
        required: ['skill_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ofrecerMicroDiagnostico',
      description:
        'Envía un botón de confirmación de WhatsApp al prospecto para que acepte o rechace el micro-diagnóstico gratuito. Usar cuando el prospecto muestre interés en conocer más o pida información sobre el servicio. NO usar si ya hay un diagnóstico completado.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generarMicroDiagnostico',
      description:
        'Genera el micro-diagnóstico de automatización con las respuestas recopiladas y devuelve el link público. Usar cuando el prospecto haya respondido todas las preguntas del diagnóstico.',
      parameters: {
        type: 'object',
        properties: {
          nombre:    { type: 'string', description: 'Nombre del prospecto' },
          empresa:   { type: 'string', description: 'Nombre de la empresa' },
          actividad: { type: 'string', description: 'A qué se dedica la empresa y años operando' },
          empleados: { type: 'string', description: 'Número aproximado de empleados' },
          herramientas: { type: 'string', description: 'Software o herramientas digitales que usan' },
          programacion: { type: 'string', description: 'Si tienen área de programación propia' },
          cuello_botella: { type: 'string', description: 'Proceso o tarea que genera cuello de botella' },
        },
        required: ['nombre', 'empresa'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calificar',
      description:
        'Calcula un score 1-10 del lead según el perfil ideal. Score ≥ 7 = procede a agendar. Score < 7 = responde con calidez, no agendes.',
      parameters: {
        type: 'object',
        properties: {
          tieneEmpresaConsolidada: { type: 'boolean', description: '¿La empresa tiene 10+ años operando?' },
          tieneEquipoMediano:      { type: 'boolean', description: '¿Equipo de 200-1000 personas?' },
          dolorOperativoConcreto:  { type: 'boolean', description: '¿Dolor real identificado (no solo curiosidad)?' },
          hayDecisor:              { type: 'boolean', description: '¿Habla con alguien que puede decidir o escalar?' },
          tienePresupuesto:        { type: 'boolean', description: '¿Dispuesto a invertir en solución real?' },
          urgenciaMedia:           { type: 'boolean', description: '¿Quiere moverse en 2-3 meses?' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'guardarLead',
      description:
        'Guarda los datos del prospecto en Airtable CRM. Usar cuando tengas nombre + empresa + algún dato de calificación.',
      parameters: {
        type: 'object',
        properties: {
          nombre:     { type: 'string', description: 'Nombre del prospecto' },
          telefono:   { type: 'string', description: 'Teléfono del prospecto' },
          empresa:      { type: 'string', description: 'Nombre de la empresa' },
          antiguedad:   { type: 'string', description: 'Años operando' },
          empleados:    { type: 'string', description: 'Rango de empleados' },
          dolor:        { type: 'string', description: 'Procesos que más les quitan tiempo o no funcionan bien' },
          herramientas: { type: 'string', description: 'Herramientas digitales que usan actualmente (Excel, CRM, ERP…)' },
          intentos:     { type: 'string', description: 'Si han intentado automatizar antes y qué pasó' },
          impacto:      { type: 'string', description: 'Tiempo o dinero estimado que ahorrarían al resolver el problema' },
          score:        { type: 'number', description: 'Score de calificación 0-10' },
        },
        required: ['nombre', 'telefono'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agendar',
      description:
        'Genera el link de Cal.com para agendar llamada de diagnóstico. SOLO usar si calificar() devolvió score ≥ 7.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del lead' },
          email:  { type: 'string', description: 'Email del lead (opcional)' },
        },
        required: ['nombre'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'derivarHumano',
      description:
        'Cambia la conversación a modo HUMAN. Usar cuando el lead pida algo fuera del scope: precios específicos, quejas, contratos.',
      parameters: {
        type: 'object',
        properties: {
          razon: { type: 'string', description: '¿Por qué se deriva? Para que el humano tenga contexto.' },
        },
        required: ['razon'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registrarEnCRM',
      description:
        'Registra al prospecto como Contacto y crea un Deal en el CRM de FlowDesk. Llama esto en cuanto el prospecto acepte hacer el micro-diagnóstico, ANTES de empezar las preguntas.',
      parameters: {
        type: 'object',
        properties: {
          nombre:   { type: 'string', description: 'Nombre del prospecto' },
          empresa:  { type: 'string', description: 'Nombre de la empresa (si ya lo sabes)' },
          telefono: { type: 'string', description: 'Teléfono del prospecto con código de país' },
        },
        required: ['nombre', 'telefono'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generarMicroDiagnostico',
      description:
        'Genera el micro-diagnóstico con IA después de recibir TODAS las respuestas del prospecto. Llama esto SOLO cuando hayas hecho todas las preguntas del diagnóstico y tengas todas las respuestas. Devuelve la URL pública del micro-diagnóstico para enviar al prospecto.',
      parameters: {
        type: 'object',
        properties: {
          nombre:   { type: 'string', description: 'Nombre del prospecto' },
          empresa:  { type: 'string', description: 'Nombre de la empresa' },
          telefono: { type: 'string', description: 'Teléfono del prospecto' },
          deal_id:  { type: 'string', description: 'ID del deal obtenido de registrarEnCRM (puede ser vacío si no se registró)' },
          respuestas: {
            type: 'object',
            description: 'Objeto con las respuestas del prospecto a cada pregunta del diagnóstico. Usa el número de pregunta como llave ("1", "2", "3"…) y la respuesta como valor.',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['nombre', 'telefono', 'respuestas'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'moverEnPipeline',
      description:
        'Mueve el Deal del prospecto a una etapa específica del pipeline CRM. Llama esto después de generarMicroDiagnostico para mover el deal a "Micro Diagnóstico".',
      parameters: {
        type: 'object',
        properties: {
          deal_id:    { type: 'string', description: 'ID del deal' },
          stage_name: { type: 'string', description: 'Nombre exacto de la etapa destino en el pipeline' },
        },
        required: ['deal_id', 'stage_name'],
      },
    },
  },
];

// ─── servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class SalesBotService {
  private readonly logger = new Logger(SalesBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionAdapter,
  ) {}

  private tablesReady = false;
  private async ensureTables(): Promise<void> {
    if (this.tablesReady) return;
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "bot_conversations" (
        "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "phone" TEXT NOT NULL,
        "jid" TEXT NOT NULL, "contact_name" TEXT, "mode" TEXT NOT NULL DEFAULT 'AI',
        "instance_name" TEXT NOT NULL, "last_message_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "bot_conversations_pkey" PRIMARY KEY ("id")
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "bot_conversations_tenant_id_phone_key"
      ON "bot_conversations"("tenant_id","phone")
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "bot_messages" (
        "id" TEXT NOT NULL, "conversation_id" TEXT NOT NULL,
        "role" TEXT NOT NULL, "content" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "bot_messages_pkey" PRIMARY KEY ("id")
      )
    `);
    // Agregar columnas de seguimiento (idempotente en PostgreSQL)
    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE "bot_conversations"
        ADD COLUMN IF NOT EXISTS "seguimiento_activo"          BOOLEAN   NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "seguimiento_inicio"          TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "etapa_seguimiento"           INTEGER   NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "diagnostico_completado"      BOOLEAN   NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "prospect_data"               TEXT      NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "pending_skill_confirmation"  TEXT
    `);
    this.tablesReady = true;
    this.logger.log('SalesBot: tablas auto-creadas/verificadas');
  }

  private async loadConvState(convId: string): Promise<{
    diagnosticoCompletado: boolean;
    pendingSkillConfirmation: string | null;
  }> {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT diagnostico_completado, pending_skill_confirmation FROM "bot_conversations" WHERE id = $1`, convId,
    );
    return {
      diagnosticoCompletado: Boolean(rows[0]?.diagnostico_completado),
      pendingSkillConfirmation: rows[0]?.pending_skill_confirmation ?? null,
    };
  }

  private async clearPendingSkill(convId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "bot_conversations" SET pending_skill_confirmation = NULL WHERE id = $1`, convId,
    );
  }

  private microTableReady = false;
  private async ensureMicroTable(): Promise<void> {
    if (this.microTableReady) return;
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "micro_diagnoses" (
        "id" TEXT NOT NULL,
        "token" TEXT NOT NULL,
        "conversation_id" TEXT,
        "prospect_data" TEXT NOT NULL DEFAULT '{}',
        "generated_content" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "micro_diagnoses_pkey" PRIMARY KEY ("id")
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "micro_diagnoses_token_key" ON "micro_diagnoses"("token")
    `);
    this.microTableReady = true;
  }

  async handle(params: HandleParams): Promise<void> {
    await this.ensureTables();
    const { phone, jid, message, contactName, tenantId, instanceName } = params;

    // 1. Obtener o crear conversación
    let conversation = await this.prisma.botConversation.findUnique({
      where: { tenant_id_phone: { tenant_id: tenantId, phone } },
    });

    if (!conversation) {
      conversation = await this.prisma.botConversation.create({
        data: {
          tenant_id: tenantId,
          phone,
          jid,
          contact_name: contactName ?? null,
          instance_name: instanceName,
          mode: 'AI',
        },
      });
    } else {
      await this.prisma.botConversation.update({
        where: { id: conversation.id },
        data: { last_message_at: new Date(), contact_name: contactName ?? conversation.contact_name, jid },
      });
    }

    // 2. Guardar mensaje del usuario
    await this.prisma.botMessage.create({
      data: { conversation_id: conversation.id, role: 'user', content: message },
    });

    // 3. Si está en modo HUMAN, no responder
    if (conversation.mode === 'HUMAN') return;

    // 4. Obtener historial para el LLM (últimos 20 mensajes)
    const history = await this.prisma.botMessage.findMany({
      where: { conversation_id: conversation.id },
      orderBy: { created_at: 'asc' },
      take: 20,
    });

    // 5. Cargar estado de la conversación (diagnóstico completado, skill pendiente)
    const convState = await this.loadConvState(conversation.id);

    // 5b. Manejar confirmación pendiente de skill
    let systemNote = '';
    let activeDeliverableId = convState.activeDeliverableId;
    if (convState.pendingSkillConfirmation) {
      const affirm = /\bsi\b|\bsí\b|\byes\b|✅|claro|quiero|adelante|confirmado|dale|ok\b/i.test(message);
      const deny   = /\bno\b|\bnope\b|❌|ahora no|después|luego|tampoco|paso\b/i.test(message);
      if (affirm) {
        await this.clearPendingSkill(conversation.id);
        if (convState.pendingSkillConfirmation === 'micro_diagnosis') {
          systemNote = '\n\nNOTA DEL SISTEMA: El usuario acaba de confirmar que quiere el micro-diagnóstico. Comienza AHORA con la primera pregunta del diagnóstico. No envíes más preguntas de introducción.';
        } else if (convState.pendingSkillConfirmation.startsWith('deliverable:')) {
          const delivId = convState.pendingSkillConfirmation.split(':')[1];
          await this.prisma.$executeRawUnsafe(
            `UPDATE "bot_conversations" SET active_deliverable_id = $1 WHERE id = $2`, delivId, conversation.id,
          );
          activeDeliverableId = delivId;
          systemNote = '\n\nNOTA DEL SISTEMA: El usuario acaba de confirmar el entregable. Comienza AHORA con la primera pregunta. Una a la vez, en el orden indicado.';
        }
      } else if (deny) {
        await this.clearPendingSkill(conversation.id);
        systemNote = '\n\nNOTA DEL SISTEMA: El usuario rechazó la propuesta anterior. Continúa la conversación de forma natural sin insistir en el mismo tema.';
      }
    }

    // 6. Obtener system prompt contextualizado
    const systemPrompt = (await this.buildSystemPrompt(tenantId, convState.diagnosticoCompletado, activeDeliverableId)) + systemNote;

    // 7. Llamar a OpenRouter con herramientas
    const reply = await this.runAgentLoop(systemPrompt, history, conversation.id, phone, tenantId, jid, instanceName);

    // Botón enviado — no hay texto adicional que guardar ni enviar
    if (!reply || reply === '__BUTTON_SENT__') return;

    // 7. Guardar respuesta del asistente
    await this.prisma.botMessage.create({
      data: { conversation_id: conversation.id, role: 'assistant', content: reply },
    });

    await this.prisma.botConversation.update({
      where: { id: conversation.id },
      data: { last_message_at: new Date() },
    });

    // 8. Enviar respuesta por WhatsApp
    await this.evolution.sendText(instanceName, jid, reply);
  }

  // ─── CRM helpers ───────────────────────────────────────────────────────────

  private async registrarEnCRM(
    tenantId: string,
    nombre: string,
    empresa: string | undefined,
    telefono: string,
  ): Promise<{ contact_id: string; deal_id: string }> {
    let contact = await this.prisma.contact.findFirst({
      where: { tenant_id: tenantId, phone: telefono },
    });

    if (!contact) {
      const parts = (nombre || 'Prospecto').split(' ');
      contact = await this.prisma.contact.create({
        data: {
          tenant_id: tenantId,
          first_name: parts[0],
          last_name: parts.slice(1).join(' ') || '',
          phone: telefono,
          company: empresa ?? null,
          status: 'lead',
        },
      });
    }

    const pipeline = await this.prisma.pipeline.findFirst({
      where: { tenant_id: tenantId, pipeline_type: 'sales', is_active: true },
      include: { stages: { orderBy: { order_index: 'asc' } } },
    });

    if (!pipeline || pipeline.stages.length === 0) {
      return { contact_id: contact.id, deal_id: '' };
    }

    const agentSlot = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
      select: { id: true },
    });

    const deal = await this.prisma.deal.create({
      data: {
        tenant_id: tenantId,
        pipeline_id: pipeline.id,
        stage_id: pipeline.stages[0].id,
        contact_id: contact.id,
        owner_id: agentSlot?.id ?? null,
        title: empresa ? `${empresa} — WhatsApp` : `${nombre} — WhatsApp`,
        status: 'open',
      } as any,
    });

    return { contact_id: contact.id, deal_id: deal.id };
  }

  private async generarMicroDiagnosticoIA(
    tenantId: string,
    nombre: string,
    empresa: string | undefined,
    telefono: string,
    respuestas: Record<string, string>,
    dealId: string | undefined,
  ): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model  = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4-5';

    const respuestasFormateadas = Object.entries(respuestas)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    const prompt = `Eres un consultor experto en automatización de procesos empresariales para MentorIA Systems, una empresa de tecnología IA First.
Analiza estas respuestas y genera un micro-diagnóstico profesional en JSON con esta estructura EXACTA:
{
  "situacion_actual": "párrafo de 2-3 oraciones sobre su situación actual basado en sus respuestas",
  "hallazgos": ["hallazgo concreto 1", "hallazgo concreto 2", "hallazgo concreto 3"],
  "impacto_estimado": "párrafo sobre el impacto potencial de implementar la metodología IA First en su operación",
  "recomendacion": "párrafo con recomendación concreta y por qué el diagnóstico completo con MentorIA es el siguiente paso"
}

Empresa: ${empresa || 'No especificada'}
Contacto: ${nombre}
Respuestas del prospecto:
${respuestasFormateadas}

Responde SOLO con el JSON válido. Sin markdown, sin explicación.`;

    let diagnosticData: {
      situacion_actual: string;
      hallazgos: string[];
      impacto_estimado: string;
      recomendacion: string;
    } = {
      situacion_actual: `${empresa || nombre} opera con procesos que tienen oportunidades claras de optimización con IA.`,
      hallazgos: [
        'Procesos manuales identificados con alto potencial de automatización',
        'Herramientas actuales no integradas entre sí',
        'Oportunidad de eliminar horas de trabajo humano repetitivo',
      ],
      impacto_estimado: 'Con la metodología IA First podríamos reducir significativamente el tiempo dedicado a tareas operativas.',
      recomendacion: 'Un diagnóstico completo nos permitirá mapear con precisión los puntos de automatización de mayor impacto para tu empresa.',
    };

    if (apiKey) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://flowdesk.io',
            'X-Title': 'FlowDesk MicroDiagnóstico',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const text = data.choices?.[0]?.message?.content ?? '';
          const match = text.match(/\{[\s\S]+\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.situacion_actual && parsed.hallazgos && parsed.impacto_estimado && parsed.recomendacion) {
              diagnosticData = parsed;
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`generarMicroDiagnosticoIA: ${err?.message ?? 'error desconocido'}, usando fallback`);
      }
    }

    const slot = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
      select: { agent_config: true },
    });
    const cfg = (slot?.agent_config as Record<string, any>) ?? {};

    const record = await this.prisma.microDiagnostico.create({
      data: {
        tenant_id: tenantId,
        lead_name: nombre,
        lead_company: empresa ?? null,
        lead_phone: telefono,
        responses: respuestas,
        diagnostic_data: diagnosticData,
        deal_id: dealId || null,
        cal_booking_url: cfg.cal_booking_url ?? null,
      },
    });

    const frontendUrl = process.env.APP_FRONTEND_URL ?? 'https://app.flowdesk.mx';
    return `${frontendUrl}/micro/${record.token}`;
  }

  private async moverEnPipelinePrivado(tenantId: string, dealId: string, stageName: string): Promise<void> {
    if (!dealId) return;
    const stage = await this.prisma.pipelineStage.findFirst({
      where: {
        tenant_id: tenantId,
        name: { contains: stageName, mode: 'insensitive' },
      },
    });
    if (!stage) {
      this.logger.warn(`moverEnPipeline: etapa "${stageName}" no encontrada en tenant ${tenantId}`);
      throw new Error(`Etapa "${stageName}" no encontrada en el pipeline.`);
    }
    await this.prisma.deal.update({
      where: { id: dealId, tenant_id: tenantId },
      data: { stage_id: stage.id },
    });
  }

  // ─── System prompt ─────────────────────────────────────────────────────────

  private async buildSystemPrompt(tenantId: string, diagnosticoCompletado = false): Promise<string> {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
      select: {
        agent_config: true,
        agent_skills: {
          where: { action_type: { not: 'text' }, status: 'active' },
          select: { action_type: true, trigger_condition: true, name: true },
        },
      },
    });

    const cfg = (slot?.agent_config as Record<string, any>) ?? {};
    const nombre = cfg.nombre ?? 'Leo';

    // Skills de acción: generan instrucciones extra para el LLM
    const actionSkills = (slot?.agent_skills ?? []) as { action_type: string; trigger_condition: string; name: string }[];
    const skillsSection = actionSkills.length > 0
      ? '\n\n## Skills de acción configurados\n' + actionSkills.map(s => {
          if (s.action_type === 'micro_diagnosis') {
            return `- **${s.name}**: ${s.trigger_condition}\n  → Llama a \`ofrecerMicroDiagnostico()\``;
          }
          if (s.action_type === 'schedule_meeting') {
            return `- **${s.name}**: ${s.trigger_condition}\n  → Llama a \`agendar()\` con el nombre del prospecto`;
          }
          if (s.action_type === 'webhook') {
            return `- **${s.name}**: ${s.trigger_condition}\n  → Llama a \`callWebhook({ skill_name: "${s.name}" })\``;
          }
          return '';
        }).filter(Boolean).join('\n')
      : '';

    const misionSection = cfg.mision ? `\n## Misión\n${cfg.mision}` : '';
    const enfoqueSection = cfg.enfoque ? `\n## En qué enfocarse\n${cfg.enfoque}` : '';
    const seguimientoSection = cfg.tarea_seguimiento
      ? `\n## Tarea de seguimiento (si no agenda)\n${cfg.tarea_seguimiento}`
      : '';

    if (diagnosticoCompletado) {
      return `Eres ${cfg.nombre ?? 'el Agente de Ventas'} de este negocio. Ya tuviste una conversación previa con este prospecto en la que realizaste el micro-diagnóstico y las preguntas de descubrimiento.
${misionSection}
## Identidad del negocio

**Qué hacemos:** ${cfg.actividad ?? ''}
**Propuesta de valor:** ${cfg.propuesta_valor ?? ''}
${enfoqueSection}
## Tu misión en este momento

El prospecto ya conoce nuestro servicio y ya nos compartió su situación. Tu único objetivo ahora es convencerlo de agendar una reunión de 30 minutos para resolver sus dudas.

- NO repitas el micro-diagnóstico ni las preguntas de descubrimiento.
- Habla de los BENEFICIOS concretos que obtendría al trabajar con nosotros.
- Responde sus dudas y objeciones con calidez y argumentos de valor.
- Cuando sea el momento, envíale el link de agendamiento con agendar().
- Si insiste en precios o condiciones específicas, usa derivarHumano().

## Criterios de calificación

**Lead calificado — procede a agendar:**
${cfg.criterios_buen_lead ?? ''}

**Lead no calificado — responde con calidez, NO agendes:**
${cfg.criterios_mal_lead ?? ''}
${seguimientoSection}
## Reglas de comunicación

- Responde en español neutro, conversacional
- Mensajes breves: 2 a 4 líneas máximo
- No uses emojis en exceso
- Una pregunta a la vez — espera la respuesta antes de continuar${skillsSection}`.trim();
    }

    const journeySection =
      Array.isArray(cfg.journey) && cfg.journey.length > 0
        ? this.renderJourneyNodes(cfg.journey, '')
        : this.buildLegacyJourneySection(cfg);

    return `Eres ${cfg.nombre ?? 'el Agente de Ventas'} de este negocio. Tu trabajo es atender mensajes de WhatsApp y guiar al prospecto a través del flujo de conversación.
${misionSection}
## Identidad del negocio

**Qué hacemos:** ${cfg.actividad ?? ''}
**Propuesta de valor:** ${cfg.propuesta_valor ?? ''}
${enfoqueSection}
## Flujo de conversación

Sigue este flujo EXACTAMENTE, en el orden indicado. UNA SOLA PREGUNTA O MENSAJE POR TURNO:

${journeySection}

## Criterios de calificación

**Lead calificado — procede a agendar:**
${cfg.criterios_buen_lead ?? ''}

**Lead no calificado — responde con calidez, NO agendes:**
${cfg.criterios_mal_lead ?? ''}
${seguimientoSection}
## Reglas de comunicación

- Responde en español neutro, conversacional
- Mensajes breves: 2 a 4 líneas máximo
- No uses emojis en exceso
- Una pregunta o mensaje a la vez — espera la respuesta antes de continuar
- Si te desvían del tema, vuelve amablemente al flujo
- Si piden precios, contratos o casos complejos, usa derivarHumano()

## Cuándo usar cada herramienta

- **guardarLead**: cuando tengas nombre + empresa + algún dato útil
- **generarMicroDiagnostico**: cuando el prospecto haya respondido todas las preguntas del diagnóstico
- **calificar**: cuando tengas información suficiente para evaluar si encaja
- **agendar**: SOLO si calificar() devolvió score ≥ 7
- **derivarHumano**: precios, quejas, casos fuera de guión${skillsSection}`.trim();
  }

  private renderJourneyNodes(nodes: any[], indent: string): string {
    const lines: string[] = [];
    for (const node of nodes) {
      if (!node || !node.type) continue;

      if (node.type === 'dialogo') {
        if (node.branching) {
          lines.push(`${indent}[${node.label}] — Envía: "${node.mensaje}"`);
          lines.push(`${indent}  Espera respuesta.`);
          if (Array.isArray(node.si) && node.si.length > 0) {
            lines.push(`${indent}  → SI ACEPTA/SÍ:`);
            lines.push(this.renderJourneyNodes(node.si, `${indent}    `));
          }
          if (Array.isArray(node.no) && node.no.length > 0) {
            lines.push(`${indent}  → SI RECHAZA/NO:`);
            lines.push(this.renderJourneyNodes(node.no, `${indent}    `));
          }
        } else {
          lines.push(`${indent}[${node.label}] — Envía: "${node.mensaje}"`);
        }
      } else if (node.type === 'pregunta') {
        if (node.answerType === 'multiple' && Array.isArray(node.options) && node.options.length > 0) {
          const opts = node.options.map((o: string, i: number) => `${i + 1}. ${o}`).join(' | ');
          lines.push(`${indent}[${node.label}] — Pregunta: "${node.pregunta}" — Opciones: ${opts}`);
        } else {
          lines.push(`${indent}[${node.label}] — Pregunta: "${node.pregunta}" — Espera respuesta libre.`);
        }
      } else if (node.type === 'entregable') {
        lines.push(`${indent}[${node.label}] — Llama a generarMicroDiagnostico() con las respuestas recopiladas. Cuando obtengas el link, envíaselo al prospecto.`);
      }
    }
    return lines.join('\n');
  }

  private buildLegacyJourneySection(cfg: Record<string, any>): string {
    const preguntas = (cfg.preguntas_calificacion ?? cfg.preguntas_microdiagnostico ?? []) as any[];
    const preguntasList = preguntas.length
      ? preguntas.map((p: any, i: number) => `  ${i + 1}. ${typeof p === 'string' ? p : p.text ?? p}`).join('\n')
      : '  1. ¿A qué se dedica la empresa y cuántos años lleva operando?\n  2. ¿Cuántos empleados tiene?\n  3. ¿Qué herramientas digitales usan?\n  4. ¿Qué proceso genera más cuello de botella?';
    return `1. [Bienvenida] — Saluda y preséntate.
2. [Datos] — Recoge nombre, empresa y actividad (una pregunta a la vez).
3. [Gancho] — Ofrece el micro-diagnóstico gratuito. Si acepta:
${preguntasList}
   Luego llama a generarMicroDiagnostico() y envía el enlace.
   Si rechaza: ${cfg.oferta_llamada_sin_diagnostico ?? 'Ofrece una llamada de 15 minutos.'}
4. [Cierre] — Califica con calificar() y cierra según el resultado.`;
  }

  // ─── Agent loop (OpenRouter + tools) ──────────────────────────────────────

  private async runAgentLoop(
    systemPrompt: string,
    history: Array<{ role: string; content: string }>,
    conversationId: string,
    phone: string,
    tenantId: string,
    jid: string,
    instanceName: string,
  ): Promise<string | null> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const agentSlot = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
      select: { agent_config: true },
    });
    const cfg = (agentSlot?.agent_config as Record<string, unknown>) ?? {};
    const model = cfg?.model as string ?? process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';

    if (!apiKey) {
      this.logger.error('OPENROUTER_API_KEY no configurada');
      return null;
    }

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    ];

    const MAX_TURNS = 5;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://flowdesk.io',
          'X-Title': 'FlowDesk Sales Agent',
        },
        body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.4 }),
      });

      if (!res.ok) {
        this.logger.error(`OpenRouter error ${res.status}`);
        return null;
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const msg = choice?.message;

      if (!msg) return null;

      // Sin tool calls → respuesta final
      if (!msg.tool_calls?.length) return msg.content ?? null;

      // Ejecutar tool calls
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });

      for (const call of msg.tool_calls as ToolCall[]) {
        if (call.type !== 'function') continue;
        let args: any = {};
        try { args = JSON.parse(call.function.arguments); } catch {}

        const result = await this.executeTool(call.function.name, args, conversationId, phone, tenantId, jid, instanceName);
        if (result?.__button_sent) return '__BUTTON_SENT__';
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }

    return 'Déjame un momento — vuelvo contigo enseguida.';
  }

  // ─── Tool executor ─────────────────────────────────────────────────────────

  private async executeTool(
    name: string,
    args: any,
    conversationId: string,
    phone: string,
    _tenantId: string,
    jid: string,
    instanceName: string,
  ): Promise<any> {
    switch (name) {

      case 'callWebhook': {
        // Buscar el skill por nombre para obtener su webhook_url desde action_config
        const webhookSkill = await this.prisma.agentSkill.findFirst({
          where: { name: args.skill_name, status: 'active', action_type: 'webhook' },
          select: { action_config: true, name: true },
        });
        const config = (webhookSkill?.action_config as Record<string, string> | null) ?? {};
        const webhookUrl = config.webhook_url;
        if (!webhookUrl) return { ok: false, message: `Webhook no configurado para skill: ${args.skill_name}` };

        // Recuperar datos del prospecto para enviarlos al webhook
        const conv = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT prospect_data FROM "bot_conversations" WHERE id = $1 LIMIT 1`,
          conversationId,
        );
        let prospectData: Record<string, string> = {};
        try { prospectData = JSON.parse(conv?.[0]?.prospect_data ?? '{}'); } catch {}

        const payload = {
          skill: args.skill_name,
          conversation_id: conversationId,
          phone,
          prospect: prospectData,
          triggered_at: new Date().toISOString(),
        };

        try {
          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
          });
          const data = res.ok ? await res.json().catch(() => ({})) : {};
          // Si el webhook devuelve { reply: "..." }, envíalo directamente por WhatsApp
          if (data?.reply && typeof data.reply === 'string') {
            await this.evolution.sendText(instanceName, jid, data.reply);
            return { __button_sent: true }; // reusar sentinel: ya enviamos la respuesta, no enviar nada más
          }
          return { ok: true, message: `Webhook ejecutado: ${webhookUrl}`, data };
        } catch (err: any) {
          this.logger.error(`callWebhook error: ${err?.message}`);
          return { ok: false, message: 'No se pudo contactar el webhook en este momento.' };
        }
      }

      case 'ofrecerMicroDiagnostico': {
        await this.evolution.sendButtons(instanceName, jid, {
          description: '¿Te gustaría que generemos un micro-diagnóstico gratuito de automatización para tu empresa? Es un análisis rápido con recomendaciones personalizadas. 🎯',
          footer: 'MentorIA Systems',
          buttons: [
            { id: 'btn_micro_si', text: '✅ Sí, me interesa' },
            { id: 'btn_micro_no', text: '❌ No por ahora' },
          ],
        });
        await this.prisma.$executeRawUnsafe(
          `UPDATE "bot_conversations" SET pending_skill_confirmation = 'micro_diagnosis' WHERE id = $1`,
          conversationId,
        );
        return { __button_sent: true };
      }

      case 'generarMicroDiagnostico': {
        try {
          await this.ensureMicroTable();
          const token = Math.random().toString(36).slice(2, 14);
          const diagId = Math.random().toString(36).slice(2, 18);
          const content = JSON.stringify({
            nombre: args.nombre ?? '',
            empresa: args.empresa ?? '',
            actividad: args.actividad ?? '',
            empleados: args.empleados ?? '',
            herramientas: args.herramientas ?? '',
            programacion: args.programacion ?? '',
            cuello_botella: args.cuello_botella ?? '',
          });
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO "micro_diagnoses" ("id","token","conversation_id","prospect_data","created_at")
             VALUES ($1,$2,$3,$4,NOW())`,
            diagId, token, conversationId, content,
          );
          // Marcar diagnóstico completado e iniciar ventana de seguimiento
          await this.prisma.$executeRawUnsafe(`
            UPDATE "bot_conversations"
            SET diagnostico_completado = TRUE,
                seguimiento_activo     = TRUE,
                seguimiento_inicio     = NOW(),
                etapa_seguimiento      = 0,
                prospect_data          = $1
            WHERE id = $2
          `, content, conversationId);
          const url = `https://app.flowdesk.mx/micro/${token}`;
          return { ok: true, url, message: `Micro-diagnóstico generado: ${url}` };
        } catch (err: any) {
          this.logger.error('generarMicroDiagnostico error', err?.message);
          return { ok: false, message: 'No se pudo generar el diagnóstico en este momento.' };
        }
      }

      case 'calificar': {
        let score = 0;
        if (args.tieneEmpresaConsolidada) score += 2;
        if (args.tieneEquipoMediano)      score += 3;
        if (args.dolorOperativoConcreto)  score += 2;
        if (args.hayDecisor)              score += 1;
        if (args.tienePresupuesto)        score += 1;
        if (args.urgenciaMedia)           score += 1;
        const califica = score >= 7;
        return {
          ok: true, score, califica,
          mensaje: califica
            ? 'Lead cualificado. Procede a agendar llamada de diagnóstico.'
            : 'Lead no cualifica en este momento. Responde con calidez y deja la puerta abierta.',
        };
      }

      case 'guardarLead': {
        const apiKey  = process.env.AIRTABLE_API_KEY;
        const baseId  = process.env.AIRTABLE_BASE_ID;
        const tableId = process.env.AIRTABLE_TABLE_NAME ?? 'Prospectos';
        if (!apiKey || !baseId) return { ok: false, message: 'Airtable no configurado.' };

        try {
          const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fields: {
                  Nombre:     args.nombre,
                  'Teléfono': args.telefono ?? phone,
                  Empresa:    args.empresa     ?? '',
                  Antigüedad: args.antiguedad  ?? '',
                  Empleados:  args.empleados   ?? '',
                  Dolor:        args.dolor        ?? '',
                  Herramientas: args.herramientas ?? '',
                  Intentos:     args.intentos     ?? '',
                  Impacto:      args.impacto      ?? '',
                  Score:      args.score       ?? null,
                  Estado:     'Nuevo',
                  Fuente:     'WhatsApp Bot',
                  Fecha:      new Date().toISOString().split('T')[0],
                },
              }),
            },
          );
          if (!res.ok) return { ok: false, message: `Airtable error ${res.status}` };
          const data = await res.json();
          return { ok: true, message: 'Prospecto guardado en Airtable CRM', id: data.id };
        } catch (err: any) {
          return { ok: false, message: err.message };
        }
      }

      case 'agendar': {
        const slot = await this.prisma.teamSlot.findFirst({
          where: { type: 'AI_AGENT', agent_role: 'sales' },
          select: { agent_config: true },
        });
        const cfg = (slot?.agent_config as any) ?? {};
        const base = cfg.cal_booking_url ?? process.env.CAL_BOOKING_URL ?? '';
        if (!base) return { ok: false, message: 'CAL_BOOKING_URL no configurada.' };

        const url = new URL(base);
        url.searchParams.set('name', args.nombre);
        if (args.email) url.searchParams.set('email', args.email);

        // Cancelar seguimiento — el prospecto agendó reunión
        await this.prisma.$executeRawUnsafe(
          `UPDATE "bot_conversations" SET seguimiento_activo = FALSE WHERE id = $1`,
          conversationId,
        );

        return { ok: true, link: url.toString(), message: `Envía este link: ${url}` };
      }

      case 'derivarHumano': {
        await this.prisma.botConversation.update({
          where: { id: conversationId },
          data: { mode: 'HUMAN' },
        });
        return {
          ok: true,
          message: `Conversación derivada a agente humano. Razón: ${args.razon}`,
          instruccion: "Responde al usuario: 'Voy a transferirte con un asesor. Te atenderá en breve.' No respondas más en esta conversación.",
        };
      }

      case 'registrarEnCRM': {
        const { nombre, empresa, telefono: tel } = args;
        try {
          const result = await this.registrarEnCRM(tenantId, nombre, empresa, tel ?? phone);
          return { ok: true, contact_id: result.contact_id, deal_id: result.deal_id, message: 'Prospecto registrado en CRM.' };
        } catch (err: any) {
          this.logger.error(`registrarEnCRM error: ${err.message}`);
          return { ok: false, message: 'No se pudo registrar en CRM, continúa con el proceso.' };
        }
      }

      case 'generarMicroDiagnostico': {
        const { nombre, empresa, telefono: tel2, respuestas, deal_id } = args;
        try {
          const url = await this.generarMicroDiagnosticoIA(tenantId, nombre, empresa, tel2 ?? phone, respuestas, deal_id);
          return { ok: true, url, message: `Micro-diagnóstico generado. Envía esta URL al prospecto: ${url}` };
        } catch (err: any) {
          this.logger.error(`generarMicroDiagnostico error: ${err.message}`);
          return { ok: false, message: 'Hubo un error al generar el diagnóstico. Intenta de nuevo.' };
        }
      }

      case 'moverEnPipeline': {
        const { deal_id: dId, stage_name } = args;
        try {
          await this.moverEnPipelinePrivado(tenantId, dId, stage_name);
          return { ok: true, message: `Deal movido a etapa "${stage_name}".` };
        } catch (err: any) {
          this.logger.error(`moverEnPipeline error: ${err.message}`);
          return { ok: false, message: 'No se pudo mover el deal.' };
        }
      }

      default:
        return { ok: false, message: `Tool desconocida: ${name}` };
    }
  }
}
