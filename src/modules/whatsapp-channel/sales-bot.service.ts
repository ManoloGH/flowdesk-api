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
    this.tablesReady = true;
    this.logger.log('SalesBot: tablas auto-creadas/verificadas');
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

    // 5. Obtener system prompt desde agent_config del slot de ventas
    const systemPrompt = await this.buildSystemPrompt(tenantId);

    // 6. Llamar a OpenRouter con herramientas
    const reply = await this.runAgentLoop(systemPrompt, history, conversation.id, phone, tenantId);

    if (!reply) return;

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

  private async buildSystemPrompt(tenantId: string): Promise<string> {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
      select: { agent_config: true },
    });

    const cfg = (slot?.agent_config as Record<string, any>) ?? {};
    const nombre = cfg.nombre ?? 'Leo';

    // Normalize to Pregunta[] — handle legacy string[] format
    type Pregunta = { text: string; type: 'open' | 'multiple'; options: string[] };
    const preguntasRaw: Array<string | Pregunta> = cfg.preguntas_microdiagnostico ?? [];
    const preguntas: Pregunta[] = preguntasRaw.length
      ? preguntasRaw.map(q =>
          typeof q === 'string'
            ? { text: q, type: 'open', options: [] }
            : { ...q, options: q.options ?? [] }
        )
      : [
          { text: '¿A qué se dedica la empresa y cuántos años lleva operando?', type: 'open', options: [] },
          { text: '¿Cuántos empleados tiene?', type: 'multiple', options: ['Menos de 50', '50 a 200', '200 a 1000', 'Más de 1000'] },
          { text: '¿Qué software o herramientas digitales usan hoy en día?', type: 'open', options: [] },
          { text: '¿Tienen área de programación?', type: 'multiple', options: ['Sí, propia', 'No, outsourcing', 'No tenemos'] },
          { text: '¿Qué tarea o proceso les genera cuello de botella?', type: 'open', options: [] },
        ];

    const preguntasStr = preguntas
      .map((q, i) => {
        if (q.type === 'multiple' && q.options.length > 0) {
          const opts = q.options.map((o, j) => `   ${j + 1}. ${o}`).join('\n');
          return `${i + 1}. [OPCIÓN MÚLTIPLE] ${q.text}\n${opts}\n   → Envía las opciones numeradas en un mensaje limpio y espera que conteste con un número o el texto de la opción.`;
        }
        return `${i + 1}. [ABIERTA] ${q.text}`;
      })
      .join('\n\n');

    return `Eres ${nombre}, agente comercial de MentorIA Systems que atiende mensajes de WhatsApp. Tu objetivo es guiar al prospecto a través de un journey de valor, no simplemente calificar y cerrar.

${cfg.actividad ? `## Quiénes somos\n${cfg.actividad}` : ''}

${cfg.propuesta_valor ?? 'Somos una empresa de tecnología expertos en entender el funcionamiento real de los negocios y simplificar los procesos eliminando horas de trabajo humano y optimizando los resultados utilizando la metodología IA First.'}

## Tu journey de 6 etapas

### ETAPA 1 — Bienvenida
Preséntate por nombre. Di brevemente qué hace MentorIA Systems (1 oración). Haz UNA pregunta abierta para conocer su negocio. Sin emojis.

### ETAPA 2 — Escucha
Escucha y entiende el negocio. No más de 2 intercambios. Una pregunta a la vez. Objetivo: entender a qué se dedican. Luego pasa a pedir sus datos de contacto (Etapa 2.5) antes de ofrecer el diagnóstico.

### ETAPA 2.5 — Datos de contacto (secuencial, antes del Gancho)
Recopila estos 3 datos en orden, haciendo UNA PREGUNTA A LA VEZ y esperando respuesta antes de continuar:

1. Nombre del prospecto — "¿Con quién tengo el gusto?"
2. Nombre de su empresa — "¿Y cómo se llama tu empresa?"
3. A qué se dedica — "¿A qué se dedica [nombre de la empresa]?"

Reglas:
- No hagas la siguiente pregunta hasta recibir respuesta a la anterior.
- Si el prospecto ya mencionó alguno de estos datos antes, omite esa pregunta específica.
- Cuando tengas los 3 datos, pasa a ofrecer el micro-diagnóstico (Etapa 3).

### ETAPA 3 — Gancho de valor
Una vez que tengas contexto, ofrece el micro-diagnóstico. Usa este texto como guía:
"${cfg.gancho ?? `Me gustaría ofrecerte algo: podemos hacerte un micro-diagnóstico gratuito de automatización para tu empresa. Solo ${preguntas.length} preguntas, menos de un minuto, y te mandamos un análisis personalizado aquí mismo por WhatsApp. ¿Te gustaría?`}"
Espera su respuesta y actúa según el caso:
- Si ACEPTA (sí, claro, va, adelante, sí me interesa, etc.) → pasa inmediatamente a Etapa 4 (las preguntas).
- Si NO ACEPTA o muestra dudas → responde con el texto de oferta de llamada y usa agendar() si dice que sí:
  "${cfg.oferta_llamada_sin_diagnostico ?? 'Entiendo, no hay problema. Si prefieres, podemos agendar una llamada de 15 minutos con uno de nuestros asesores para platicar sobre cómo funcionan nuestros servicios y si hay algo que podamos hacer por ustedes. ¿Te gustaría?'}"
  Si acepta la llamada → llama a agendar() y comparte el enlace de Cal.com.
  Si tampoco quiere la llamada → despídete con calidez y cierra la conversación.

### ETAPA 4 — Las preguntas del diagnóstico
Si el prospecto acepta:
1. PRIMERO llama a registrarEnCRM con su nombre, empresa y teléfono.
2. Luego haz las preguntas UNA POR UNA, en orden, esperando respuesta antes de continuar con la siguiente:

${preguntasStr}

Para preguntas de opción múltiple: escribe las opciones como una lista numerada en el mensaje. Acepta tanto el número como el texto de la opción como respuesta válida.

### ETAPA 5 — Entrega del micro-diagnóstico
Cuando hayas recibido respuesta a todas las preguntas (${preguntas.length} en total):
1. Llama a generarMicroDiagnostico con todas las respuestas y el deal_id obtenido de registrarEnCRM.
2. Llama a moverEnPipeline con el deal_id y stage_name "Micro Diagnóstico".
3. Envía la URL al prospecto con un mensaje como: "Listo [nombre], aquí está tu micro-diagnóstico personalizado: [URL] — tómate un momento para revisarlo y cuéntame qué te parece."

### ETAPA 6 — Cierre
Después de entregar el diagnóstico, espera su reacción. Luego evalúa el lead con calificar().
- Si califica (score ≥ 7): "${cfg.cierre_calificado ?? 'Basándonos en lo que veo en tu diagnóstico, creo que hay una oportunidad real para MentorIA en tu empresa. ¿Te gustaría agendar una llamada de 30 minutos para ver en detalle cómo podríamos transformar tu operación?'}" → llama a agendar()
- Si no califica (score < 7): "${cfg.cierre_no_calificado ?? 'Gracias por compartirme esto. Por ahora te recomendaría enfocarte en consolidar algunos procesos base. Cuando estén listos para el siguiente nivel, aquí estaremos.'}"

## Criterios de calificación
Buen lead: ${cfg.criterios_buen_lead ?? 'Empresa con 10+ años, 100+ empleados, herramientas genéricas, dolor operativo concreto identificado'}
Mal lead: ${cfg.criterios_mal_lead ?? 'Empresa con menos de 5 años, menos de 50 empleados, sin dolor claro o sin presupuesto'}

## Cuándo usar cada herramienta
- registrarEnCRM: cuando el prospecto acepta el micro-diagnóstico
- generarMicroDiagnostico: SOLO cuando tienes todas las respuestas completas (${preguntas.length} en total)
- moverEnPipeline: inmediatamente después de generarMicroDiagnostico
- calificar: después de entregar el diagnóstico para evaluar si proceder
- agendar: SOLO si calificar() devolvió score ≥ 7
- guardarLead: cuando tengas datos útiles adicionales para Airtable
- derivarHumano: si piden precios específicos, contratos o algo fuera de tu alcance

## Reglas de comunicación
- Español neutro, conversacional, profesional pero cercano
- Mensajes de 2-4 líneas máximo
- Una pregunta a la vez, siempre
- Sin emojis
- Nunca menciones las etapas por nombre al prospecto`.trim();
  }

  // ─── Agent loop (OpenRouter + tools) ──────────────────────────────────────

  private async runAgentLoop(
    systemPrompt: string,
    history: Array<{ role: string; content: string }>,
    conversationId: string,
    phone: string,
    tenantId: string,
  ): Promise<string | null> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model  = process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';

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

        const result = await this.executeTool(call.function.name, args, conversationId, phone, tenantId);
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
    tenantId: string,
  ): Promise<any> {
    switch (name) {

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
