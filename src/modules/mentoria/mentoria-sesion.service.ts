import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { MentoriaService } from './mentoria.service';

type CuboKey = 'contexto' | 'areas_procesos' | 'organigrama' | 'sistemas' | 'brechas' | 'agentes';

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

const TOOL_ACTUALIZAR_CUBO: Anthropic.Tool = {
  name: 'actualizar_cubo',
  description: 'Guarda o actualiza informacion en una seccion del cubo del cliente.',
  input_schema: {
    type: 'object',
    properties: {
      seccion: {
        type: 'string',
        enum: ['contexto', 'areas_procesos', 'organigrama', 'sistemas', 'brechas', 'agentes'],
      },
      contenido: {
        type: 'string',
        description: 'Contenido completo de la seccion (previo + nuevo).',
      },
    },
    required: ['seccion', 'contenido'],
  },
};

function buildSystemPrompt(empresa: string, cubo: Record<string, string>): string {
  const cuboState = Object.entries(cubo)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `[${k.toUpperCase()}]\n${v}`)
    .join('\n\n') || '(vacio - primera sesion)';

  return `Eres el asistente de diagnostico del asesor de MentorIA Systems. Tu interlocutor es SIEMPRE el asesor, nunca el cliente.

El asesor conduce entrevistas con el cliente (empresa: "${empresa}") y te comparte lo que le dijo.

METODOLOGIA: Cada proceso debe documentarse en 3 etapas:
1. SOLICITUD: quien lo activa (cliente/proveedor/depto.interno/programado), por donde llega (canal), que informacion proporcionan.
2. PROCESO: paso a paso — en cada paso: que data se genera, donde se registra, quien lo registra, desde donde trabaja (oficina/campo/remoto) y en que dispositivo (computadora/movil).
3. ENTREGA: que se entrega al finalizar, donde queda el registro, que exactamente se anota.

El objetivo final es un ROADMAP de 5 fases:
- Fase 1: mapear toda la data que se genera y la comunicacion que se cruza
- Fase 2: identificar entregables y reglas de negocio por proceso
- Fase 3: automatizaciones posibles
- Fase 4: agente conectado a herramientas (fase 1 del agente)
- Fase 5: agente autonomo (agente-humano-agente-resultado)

Estado actual del cubo:
${cuboState}

REGLA CRITICA: Usa actualizar_cubo SIN texto previo. Primero ejecuta TODAS las actualizaciones, luego escribe tu respuesta. NUNCA escribas "Dejame guardar" ni frases similares antes de usar la herramienta.

Seccion "areas_procesos": documenta cada proceso con las 3 etapas (SOLICITUD / PROCESO paso a paso / ENTREGA).
Seccion "brechas": enfoca en datos que se pierden entre etapas, registros inexistentes, comunicacion sin trazabilidad.
Seccion "agentes": mapea cada automatizacion / agente a su fase del roadmap (1-5).

Despues de guardar:
1. Confirma que etapas del proceso ya estan documentadas.
2. Indica que falta (solicitud, pasos, entrega, o a que fase del roadmap pertenece).
3. Sugiere 2-3 preguntas concretas para completar el mapeo.

Maximo 150 palabras. Responde en espanol.`;
}

@Injectable()
export class MentoriaSesionService {
  private readonly logger = new Logger(MentoriaSesionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mentoriaService: MentoriaService,
  ) {}

  async chatSesion(params: {
    tenantId: string;
    clienteId: string;
    message: string;
    sesionId?: string;
  }): Promise<{ text: string; cubo: Record<string, string>; sections_updated: string[] }> {
    const { tenantId, clienteId, message, sesionId } = params;

    const cliente = await this.prisma.mentoriaCliente.findFirst({
      where: { id: clienteId, tenant_id: tenantId },
    });
    if (!cliente) throw new Error('Cliente no encontrado');

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('API key de Anthropic no configurada');

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    let currentCubo = (cliente.cubo as Record<string, string>) ?? {};

    // If sesionId provided, load history from that specific session
    let fullHistory: ChatEntry[];
    if (sesionId) {
      const sesiones = ((cliente as any).sesiones_diagnostico ?? []) as any[];
      const sesion = sesiones.find((s: any) => s.id === sesionId);
      fullHistory = (sesion?.mensajes ?? []) as ChatEntry[];
    } else {
      fullHistory = (cliente.chat_history as ChatEntry[] | null) ?? [];
    }

    // Last 12 entries (~6 exchanges), only non-empty content
    const recentHistory = fullHistory
      .slice(-12)
      .filter(m => m.content?.trim());

    let currentMessages: Anthropic.MessageParam[] = [
      ...recentHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message },
    ];

    const systemPrompt = buildSystemPrompt(cliente.empresa, currentCubo);
    let assistantText = '';
    const sectionsUpdated: string[] = [];

    for (let i = 0; i < 4; i++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        tools: [TOOL_ACTUALIZAR_CUBO],
        messages: currentMessages,
      });

      if (response.stop_reason === 'end_turn') {
        for (const block of response.content) {
          if (block.type === 'text') assistantText += block.text;
        }
        break;
      }

      if (response.stop_reason === 'tool_use') {
        currentMessages.push({ role: 'assistant', content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use' || block.name !== 'actualizar_cubo') continue;

          const input = block.input as { seccion: CuboKey; contenido: string };
          currentCubo = { ...currentCubo, [input.seccion]: input.contenido };
          sectionsUpdated.push(input.seccion);

          try {
            await this.prisma.mentoriaCliente.update({
              where: { id: clienteId },
              data: { cubo: currentCubo },
            });
          } catch (e) {
            this.logger.warn(`Error guardando cubo: ${(e as any)?.message}`);
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ ok: true, seccion: input.seccion }),
          });
        }

        currentMessages.push({ role: 'user', content: toolResults });
      }
    }

    // Save messages
    if (message.trim() || assistantText.trim()) {
      const newEntries: ChatEntry[] = [
        { role: 'user', content: message, ts: new Date().toISOString() },
        ...(assistantText.trim()
          ? [{ role: 'assistant' as const, content: assistantText, ts: new Date().toISOString() }]
          : []),
      ];

      if (sesionId) {
        // Save to the named session
        try {
          await this.mentoriaService.appendSesionDiagMessages(clienteId, sesionId, newEntries);
        } catch (e) {
          this.logger.warn(`Error guardando mensajes en sesión ${sesionId}: ${(e as any)?.message}`);
        }
      } else {
        // Legacy: save to flat chat_history
        const newHistory: ChatEntry[] = [...fullHistory, ...newEntries];
        try {
          await this.prisma.mentoriaCliente.update({
            where: { id: clienteId },
            data: { chat_history: newHistory as any },
          });
        } catch (e) {
          this.logger.warn(`Error guardando chat_history: ${(e as any)?.message}`);
        }
      }
    }

    return { text: assistantText, cubo: currentCubo, sections_updated: sectionsUpdated };
  }

  // ── GENERACIÓN DE CUESTIONARIO PERSONALIZADO ────────────────────────────────

  async generarCuestionario(params: {
    tenantId: string;
    clienteId: string;
    sesionId: string;
    rolDestino: 'gerente' | 'operador';
    area: string;
  }): Promise<{ id: string; titulo: string; rol_destino: string; area: string; preguntas: any[]; generado_at: string }> {
    const { tenantId, clienteId, sesionId, rolDestino, area } = params;

    const cliente = await this.prisma.mentoriaCliente.findFirst({
      where: { id: clienteId, tenant_id: tenantId },
    });
    if (!cliente) throw new Error('Cliente no encontrado');

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('API key de Anthropic no configurada');

    const cubo = (cliente.cubo ?? {}) as Record<string, string>;
    const cuboText = Object.entries(cubo)
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `[${k.toUpperCase()}]\n${v}`)
      .join('\n\n') || '(sin información en el cubo)';

    const sesiones = ((cliente as any).sesiones_diagnostico ?? []) as any[];
    const sesion = sesiones.find((s: any) => s.id === sesionId);
    if (!sesion) throw new Error('Sesión no encontrada');

    const sesionText = ((sesion.mensajes ?? []) as any[])
      .map((m: any) => `${m.role === 'user' ? 'Asesor' : 'IA'}: ${m.content}`)
      .join('\n');

    const rolLabel = rolDestino === 'gerente' ? 'GERENTES' : 'OPERADORES';

    const prompt = `Eres experto en diagnóstico organizacional. Basándote en:

CONTEXTO DEL CLIENTE (${cliente.empresa}):
${cuboText}

SESIÓN REALIZADA CON ${(sesion.cargo ?? 'DIRECTIVO').toUpperCase()} — ${sesion.interlocutor}:
${sesionText || '(sesión sin mensajes registrados)'}

Genera un cuestionario personalizado para los ${rolLabel} del área de ${area} en ${cliente.empresa}.

INSTRUCCIONES:
1. Usa la terminología y procesos mencionados por ${sesion.interlocutor}
2. Para cada proceso clave del área, genera preguntas que sigan el modelo:
   - SOLICITUD: ¿Quién activa el proceso? ¿Por qué canal llega? ¿Qué información proporcionan?
   - PROCESO paso a paso: ¿Qué datos se generan en cada paso? ¿Dónde se registran? ¿Quién los registra? ¿Desde dónde trabaja? ¿Con qué dispositivo?
   - ENTREGA: ¿Qué se entrega al finalizar? ¿Dónde queda el registro? ¿Qué exactamente se anota?
3. Incluye preguntas sobre herramientas, sistemas, cuellos de botella y tareas repetitivas

Devuelve SOLO JSON válido (sin markdown, sin texto fuera del JSON):
{
  "preguntas": [
    {
      "seccion": "nombre del proceso (ej: Cotización a cliente, Compra de materiales)",
      "pregunta": "pregunta específica y clara",
      "contexto_empresa": "por qué esta pregunta es relevante para ${cliente.empresa} (1 frase corta)"
    }
  ]
}

Genera entre 18 y 28 preguntas. Sé específico, usa nombres de sistemas y procesos reales de ${cliente.empresa}.`;

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: 'Generates organizational diagnostic questionnaires. Respond ONLY with valid JSON. No markdown, no explanation.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '';
    let preguntas: any[] = [];
    try {
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : text);
      preguntas = parsed.preguntas ?? [];
    } catch {
      throw new Error('Error al generar el cuestionario. Intenta de nuevo.');
    }

    const cuestionario = {
      id: `cq-${Date.now()}`,
      titulo: `Cuestionario ${rolLabel.charAt(0) + rolLabel.slice(1).toLowerCase()} — ${area}`,
      rol_destino: rolDestino,
      area,
      preguntas,
      generado_at: new Date().toISOString(),
    };

    try {
      await this.mentoriaService.saveCuestionarioGenerado(clienteId, sesionId, cuestionario);
    } catch (e) {
      this.logger.warn(`Error guardando cuestionario: ${(e as any)?.message}`);
    }

    return cuestionario;
  }
}
