import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';

type CuboKey = 'contexto' | 'areas_procesos' | 'organigrama' | 'sistemas' | 'brechas' | 'agentes';

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

const TOOL_ACTUALIZAR_CUBO: Anthropic.Tool = {
  name: 'actualizar_cubo',
  description:
    'Guarda o actualiza información extraída de la conversación en una sección del cubo del cliente. ' +
    'Úsalo cada vez que el usuario comparta datos relevantes sobre la empresa. ' +
    'Si la sección ya tiene contenido, incluye el contenido previo más la nueva información.',
  input_schema: {
    type: 'object',
    properties: {
      seccion: {
        type: 'string',
        enum: ['contexto', 'areas_procesos', 'organigrama', 'sistemas', 'brechas', 'agentes'],
        description:
          'contexto = empresa, DG, objetivos | areas_procesos = áreas, procesos, problemas | ' +
          'organigrama = personas, cargos, sueldos | sistemas = software, herramientas, costos | ' +
          'brechas = gaps, ineficiencias detectadas | agentes = automatizaciones propuestas',
      },
      contenido: {
        type: 'string',
        description:
          'Texto completo y bien formateado para esa sección. ' +
          'Usa el formato de la sección (ver placeholders). ' +
          'Incluye TODO el contenido previo de la sección más la nueva información.',
      },
    },
    required: ['seccion', 'contenido'],
  },
};

function buildSystemPrompt(empresa: string, cubo: Record<string, string>): string {
  const cuboState = Object.entries(cubo)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `\n[${k.toUpperCase()}]\n${v}`)
    .join('\n') || '(vacío — primera sesión)';

  return `Eres el asistente de diagnóstico del asesor de MentorIA Systems. Tu interlocutor es SIEMPRE el asesor, nunca el cliente.

El asesor conduce las entrevistas con el cliente (empresa: "${empresa}") y te trae la información: puede contarte lo que le dijeron, dictar notas en tiempo real durante una sesión, o pedirte que le sugieras qué preguntar a continuación.

Estado actual del cubo de información:
${cuboState}

Tu rol:
1. DOCUMENTAR — cuando el asesor comparte datos del cliente, usa \`actualizar_cubo\` INMEDIATAMENTE para capturarlos en la sección correcta.
2. ORIENTAR — detecta qué secciones del cubo están vacías o incompletas y sugiere al asesor qué temas explorar en la próxima sesión.
3. SUGERIR PREGUNTAS — si el asesor lo pide (o si hay huecos evidentes), propón 2-3 preguntas concretas que podría hacer al cliente.
4. ANALIZAR — identifica brechas, ineficiencias o oportunidades de automatización a partir de lo que el asesor reporta.

Cubo que necesitas llenar:
- contexto: empresa, giro, empleados, facturación, objetivos del DG
- areas_procesos: áreas, flujos de trabajo, cuellos de botella
- organigrama: personas, cargos, responsabilidades, sueldos
- sistemas: software, herramientas, costos, integraciones manuales
- brechas: ineficiencias, tiempo perdido, errores frecuentes
- agentes: automatizaciones propuestas, procesos candidatos a IA

Reglas:
- Usa \`actualizar_cubo\` siempre que el asesor comparta información nueva del cliente.
- Cuando el cubo esté incompleto, al final de tu respuesta menciona brevemente qué falta.
- Sé conciso y útil: el asesor está en medio de un proceso de consultoría.
- Responde siempre en español.`;
}

function sse(res: any, data: object) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Explicit flush required for Railway/Nginx SSE buffering
    if (typeof res.flush === 'function') res.flush();
  }
}

function ping(res: any) {
  if (!res.writableEnded) {
    res.write(': ping\n\n');
    if (typeof res.flush === 'function') res.flush();
  }
}

@Injectable()
export class MentoriaSesionService {
  private readonly logger = new Logger(MentoriaSesionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async chatSesion(params: {
    tenantId: string;
    clienteId: string;
    message: string;
    res: any;
  }): Promise<void> {
    const { tenantId, clienteId, message, res } = params;

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Disable Nagle buffering at TCP level
    res.socket?.setNoDelay(true);
    res.flushHeaders?.();

    // Immediate start event so client knows SSE connection is alive before Anthropic call
    sse(res, { type: 'start' });

    // Keep-alive ping every 15s to prevent Railway/proxy from closing idle SSE
    const keepAlive = setInterval(() => ping(res), 15_000);

    try {
      const cliente = await this.prisma.mentoriaCliente.findFirst({
        where: { id: clienteId, tenant_id: tenantId },
      });

      if (!cliente) {
        sse(res, { type: 'error', message: 'Cliente no encontrado' });
        res.end();
        return;
      }

      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        sse(res, { type: 'error', message: 'API key de Anthropic no configurada' });
        res.end();
        return;
      }

      const anthropic = new Anthropic({ apiKey: anthropicKey });
      let currentCubo = (cliente.cubo as Record<string, string>) ?? {};

      // Load existing chat history from DB, capped to last 20 entries (~10 exchanges)
      const fullHistory: ChatEntry[] = (cliente.chat_history as ChatEntry[] | null) ?? [];
      const existingHistory = fullHistory;
      const recentHistory   = fullHistory.slice(-20);

      // Build messages array: recent history + new user message
      let currentMessages: Anthropic.MessageParam[] = [
        ...recentHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: message },
      ];

      const systemPrompt = buildSystemPrompt(cliente.empresa, currentCubo);
      let assistantText = '';

      for (let i = 0; i < 6; i++) {
        if (res.writableEnded) break;

        const stream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemPrompt,
          tools: [TOOL_ACTUALIZAR_CUBO],
          messages: currentMessages,
        });

        stream.on('text', (text) => {
          assistantText += text;
          sse(res, { type: 'text', text });
        });

        const finalMsg = await stream.finalMessage();

        if (finalMsg.stop_reason === 'end_turn') {
          // Save updated history to DB
          const newHistory: ChatEntry[] = [
            ...existingHistory,
            { role: 'user', content: message, ts: new Date().toISOString() },
            { role: 'assistant', content: assistantText, ts: new Date().toISOString() },
          ];
          try {
            await this.prisma.mentoriaCliente.update({
              where: { id: clienteId },
              data: { chat_history: newHistory as any },
            });
          } catch (e) {
            this.logger.warn(`Error guardando chat_history: ${(e as any)?.message}`);
          }
          break;
        }

        if (finalMsg.stop_reason === 'tool_use') {
          currentMessages.push({ role: 'assistant', content: finalMsg.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of finalMsg.content) {
            if (block.type !== 'tool_use') continue;
            if (block.name !== 'actualizar_cubo') continue;

            const input = block.input as { seccion: CuboKey; contenido: string };
            currentCubo = { ...currentCubo, [input.seccion]: input.contenido };

            try {
              await this.prisma.mentoriaCliente.update({
                where: { id: clienteId },
                data: { cubo: currentCubo },
              });
            } catch (e) {
              this.logger.warn(`Error guardando cubo: ${(e as any)?.message}`);
            }

            sse(res, { type: 'tool_use', seccion: input.seccion, contenido: input.contenido });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ ok: true, seccion: input.seccion }),
            });
          }

          currentMessages.push({ role: 'user', content: toolResults });
        }
      }

      sse(res, { type: 'done', cubo: currentCubo });
    } catch (e) {
      this.logger.error('chatSesion error', e);
      sse(res, { type: 'error', message: (e as any)?.message ?? 'Error inesperado' });
    } finally {
      clearInterval(keepAlive);
      if (!res.writableEnded) res.end();
    }
  }
}
