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
    'Guarda o actualiza informacion extraida de la conversacion en una seccion del cubo del cliente. ' +
    'Usalo cada vez que el usuario comparta datos relevantes sobre la empresa. ' +
    'Si la seccion ya tiene contenido, incluye el contenido previo mas la nueva informacion.',
  input_schema: {
    type: 'object',
    properties: {
      seccion: {
        type: 'string',
        enum: ['contexto', 'areas_procesos', 'organigrama', 'sistemas', 'brechas', 'agentes'],
        description:
          'contexto = empresa, DG, objetivos | areas_procesos = areas, procesos, problemas | ' +
          'organigrama = personas, cargos, sueldos | sistemas = software, herramientas, costos | ' +
          'brechas = gaps, ineficiencias detectadas | agentes = automatizaciones propuestas',
      },
      contenido: {
        type: 'string',
        description:
          'Texto completo y bien formateado para esa seccion. ' +
          'Usa el formato de la seccion (ver placeholders). ' +
          'Incluye TODO el contenido previo de la seccion mas la nueva informacion.',
      },
    },
    required: ['seccion', 'contenido'],
  },
};

function buildSystemPrompt(empresa: string, cubo: Record<string, string>): string {
  const cuboState = Object.entries(cubo)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `\n[${k.toUpperCase()}]\n${v}`)
    .join('\n') || '(vacio - primera sesion)';

  return `Eres el asistente de diagnostico del asesor de MentorIA Systems. Tu interlocutor es SIEMPRE el asesor, nunca el cliente.

El asesor conduce las entrevistas con el cliente (empresa: "${empresa}") y te trae la informacion: puede contarte lo que le dijeron, dictar notas en tiempo real durante una sesion, o pedirte que le sugiera que preguntar a continuacion.

Estado actual del cubo de informacion:
${cuboState}

Tu rol:
1. DOCUMENTAR - cuando el asesor comparte datos del cliente, usa la herramienta actualizar_cubo para capturarlos.
2. ORIENTAR - detecta que secciones del cubo estan vacias o incompletas y sugiere al asesor que temas explorar.
3. SUGERIR PREGUNTAS - si el asesor lo pide (o si hay huecos evidentes), propone 2-3 preguntas concretas.
4. ANALIZAR - identifica brechas, ineficiencias o oportunidades de automatizacion.

Cubo que necesitas llenar:
- contexto: empresa, giro, empleados, facturacion, objetivos del DG
- areas_procesos: areas, flujos de trabajo, cuellos de botella
- organigrama: personas, cargos, responsabilidades, sueldos
- sistemas: software, herramientas, costos, integraciones manuales
- brechas: ineficiencias, tiempo perdido, errores frecuentes
- agentes: automatizaciones propuestas, procesos candidatos a IA

REGLA CRITICA - USO DE HERRAMIENTAS:
- Cuando vayas a usar actualizar_cubo, HAZLO DIRECTAMENTE sin escribir ningun texto previo.
- Ejecuta TODAS las llamadas a actualizar_cubo que necesites (una por seccion) sin ningun texto entre ellas.
- SOLO escribe texto DESPUES de haber completado TODAS las actualizaciones del cubo.
- NUNCA escribas frases como "Dejame guardar esto", "Voy a registrar" o "Excelente sesion" antes de usar la herramienta. Simplemente usala.

Reglas adicionales:
- Al final de tu respuesta menciona brevemente que secciones del cubo aun faltan por completar.
- Se conciso y util: el asesor esta en medio de un proceso de consultoria.
- Responde siempre en espanol.`;
}

function sse(res: any, data: object) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
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
    res.socket?.setNoDelay(true);
    res.flushHeaders?.();

    // Immediate start event so client resets its stall timer before Anthropic call
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

      // Load existing chat history, capped to last 20 entries (~10 exchanges)
      const fullHistory: ChatEntry[] = (cliente.chat_history as ChatEntry[] | null) ?? [];
      const recentHistory = fullHistory.slice(-20);

      let currentMessages: Anthropic.MessageParam[] = [
        ...recentHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: message },
      ];

      const systemPrompt = buildSystemPrompt(cliente.empresa, currentCubo);
      let assistantText = '';

      for (let i = 0; i < 8; i++) {
        if (res.writableEnded) break;

        // Collect text for THIS turn only — do NOT emit SSE yet
        // (Anthropic may write preamble text before tool calls that we want to discard)
        let turnText = '';

        const stream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemPrompt,
          tools: [TOOL_ACTUALIZAR_CUBO],
          messages: currentMessages,
        });

        stream.on('text', (text) => { turnText += text; });

        const finalMsg = await stream.finalMessage();

        if (finalMsg.stop_reason === 'end_turn') {
          // Final response — emit to client and save
          assistantText = turnText;
          if (assistantText) {
            sse(res, { type: 'text', text: assistantText });
          }
          const newHistory: ChatEntry[] = [
            ...fullHistory,
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
          // turnText is discarded — it was preamble before tool calls
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
