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
    'Guarda o actualiza informacion extraida de la conversacion en una seccion del cubo del cliente.',
  input_schema: {
    type: 'object',
    properties: {
      seccion: {
        type: 'string',
        enum: ['contexto', 'areas_procesos', 'organigrama', 'sistemas', 'brechas', 'agentes'],
        description:
          'contexto | areas_procesos | organigrama | sistemas | brechas | agentes',
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
    .map(([k, v]) => `\n[${k.toUpperCase()}]\n${v}`)
    .join('\n') || '(vacio - primera sesion)';

  return `Eres el asistente de diagnostico del asesor de MentorIA Systems. Tu interlocutor es SIEMPRE el asesor, nunca el cliente.

El asesor conduce las entrevistas con el cliente (empresa: "${empresa}") y te comparte lo que le dijo el cliente. Tu ayudas a documentar, orientar y analizar.

Estado actual del cubo de informacion:
${cuboState}

REGLA CRITICA - HERRAMIENTAS:
- Usa actualizar_cubo DIRECTAMENTE, sin ningun texto previo.
- Ejecuta TODAS las actualizaciones necesarias primero, luego escribe tu respuesta al asesor.
- NUNCA escribas "Dejame guardar", "Voy a registrar" ni ninguna frase introductoria antes de usar la herramienta.

Tu rol (despues de guardar):
1. Confirma brevemente que seccion(es) actualizaste.
2. Indica que secciones del cubo siguen vacias o incompletas.
3. Sugiere 2-3 preguntas concretas para la proxima sesion con el cliente.

Reglas:
- Se conciso: maximo 150 palabras en tu respuesta final.
- Responde siempre en espanol.`;
}

function sse(res: any, data: object) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
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

    // Notify client the connection is alive (client resets its stall timer)
    sse(res, { type: 'start' });

    // Keep connection alive through Railway proxy while Anthropic processes
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
        if (typeof res.flush === 'function') res.flush();
      }
    }, 10_000);

    try {
      const cliente = await this.prisma.mentoriaCliente.findFirst({
        where: { id: clienteId, tenant_id: tenantId },
      });

      if (!cliente) {
        sse(res, { type: 'error', message: 'Cliente no encontrado' });
        return;
      }

      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        sse(res, { type: 'error', message: 'API key de Anthropic no configurada' });
        return;
      }

      const anthropic = new Anthropic({ apiKey: anthropicKey });
      let currentCubo = (cliente.cubo as Record<string, string>) ?? {};

      const fullHistory: ChatEntry[] = (cliente.chat_history as ChatEntry[] | null) ?? [];
      const recentHistory = fullHistory.slice(-16); // last 8 exchanges

      let currentMessages: Anthropic.MessageParam[] = [
        ...recentHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: message },
      ];

      const systemPrompt = buildSystemPrompt(cliente.empresa, currentCubo);
      let assistantText = '';

      // Non-streaming agentic loop — avoids SSE buffering issues with Railway
      for (let i = 0; i < 8; i++) {
        if (res.writableEnded) break;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: systemPrompt,
          tools: [TOOL_ACTUALIZAR_CUBO],
          messages: currentMessages,
        });

        if (response.stop_reason === 'end_turn') {
          // Extract final text from response
          for (const block of response.content) {
            if (block.type === 'text') assistantText += block.text;
          }
          // Save history
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

        if (response.stop_reason === 'tool_use') {
          currentMessages.push({ role: 'assistant', content: response.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type !== 'tool_use' || block.name !== 'actualizar_cubo') continue;

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

            // Emit tool_use immediately so cubo panel updates in real time
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

      // Send final response and done
      sse(res, { type: 'text', text: assistantText });
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
