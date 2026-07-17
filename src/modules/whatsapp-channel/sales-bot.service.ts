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

    // 5. Obtener system prompt desde agent_config del slot de ventas
    const systemPrompt = await this.buildSystemPrompt(tenantId);

    // 6. Llamar a OpenRouter con herramientas
    const reply = await this.runAgentLoop(systemPrompt, history, conversation.id, phone);

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

  // ─── System prompt ─────────────────────────────────────────────────────────

  private async buildSystemPrompt(tenantId: string): Promise<string> {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
      select: { agent_config: true },
    });

    const cfg = (slot?.agent_config as Record<string, any>) ?? {};

    const journeySection =
      Array.isArray(cfg.journey) && cfg.journey.length > 0
        ? this.renderJourneyNodes(cfg.journey, '')
        : this.buildLegacyJourneySection(cfg);

    const misionSection = cfg.mision
      ? `\n## Misión\n${cfg.mision}`
      : '';

    const enfoqueSection = cfg.enfoque
      ? `\n## En qué enfocarse\n${cfg.enfoque}`
      : '';

    const seguimientoSection = cfg.tarea_seguimiento
      ? `\n## Tarea de seguimiento (si no agenda)\n${cfg.tarea_seguimiento}`
      : '';

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
- **derivarHumano**: precios, quejas, casos fuera de guión`.trim();
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

        const result = await this.executeTool(call.function.name, args, conversationId, phone);
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
  ): Promise<any> {
    switch (name) {

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

      default:
        return { ok: false, message: `Tool desconocida: ${name}` };
    }
  }
}
