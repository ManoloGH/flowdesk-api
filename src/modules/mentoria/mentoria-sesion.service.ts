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

  return `Eres un consultor senior de transformación digital de MentorIA Systems conduciendo la sesión de diagnóstico completa con "${empresa}".

Este es un hilo continuo de diagnóstico que puede incluir distintos interlocutores a lo largo del tiempo: el Director General, gerentes de área, operadores, o notas libres del asesor. Tú manejas el hilo completo.

Estado actual del cubo de información:
${cuboState}

Tu objetivo: construir el cubo completo para diseñar la propuesta de transformación digital.

Áreas que debes cubrir en el transcurso de la conversación (en orden natural, no de golpe):

[CONTEXTO] → ¿A qué se dedica la empresa? ¿Cuántos empleados? ¿Dónde opera? ¿Facturación aprox.? ¿Objetivos del DG?
[ÁREAS & PROCESOS] → ¿Cuáles son las áreas? ¿Cómo fluye el trabajo? ¿Dónde están los cuellos de botella?
[ORGANIGRAMA] → ¿Quién hace qué? ¿Cargos, responsables, sueldos?
[SISTEMAS] → ¿Qué software usan? ¿Cuánto cuesta? ¿Dónde copian datos manualmente entre sistemas?
[BRECHAS] → ¿Qué falla? ¿Qué tiempo/dinero se pierde? ¿Qué frustra más al equipo?
[AGENTES IA] → ¿Qué procesos se pueden automatizar? ¿Qué agentes tiene sentido construir?

Reglas:
- Cuando alguien comparte información relevante, usa \`actualizar_cubo\` INMEDIATAMENTE antes de responder.
- Adapta tu tono al interlocutor: ejecutivo = estratégico, gerente = operativo, operador = concreto.
- Haz una o dos preguntas a la vez, nunca un interrogatorio.
- Escucha y profundiza antes de avanzar al siguiente tema.
- Si detectas brechas u oportunidades de automatización, documéntalas en las secciones correctas.
- Responde siempre en español. Sé empático, directo y profesional.`;
}

function sse(res: any, data: object) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
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
    res.flushHeaders?.();

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

      // Load existing chat history from DB
      const existingHistory: ChatEntry[] = (cliente.chat_history as ChatEntry[] | null) ?? [];

      // Build messages array: stored history + new user message
      let currentMessages: Anthropic.MessageParam[] = [
        ...existingHistory.map(m => ({ role: m.role, content: m.content })),
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
      if (!res.writableEnded) res.end();
    }
  }
}
