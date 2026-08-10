import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { Response } from 'express';

type CuboKey = 'contexto' | 'areas_procesos' | 'organigrama' | 'sistemas' | 'brechas' | 'agentes';

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

const SYSTEM_PROMPTS: Record<string, (empresa: string, cubo: Record<string, string>) => string> = {
  dg: (empresa, cubo) => `Eres un consultor de transformación digital de MentorIA Systems conduciendo la sesión de diagnóstico con el Director General de "${empresa}".

Estado actual del cubo de información:
${Object.entries(cubo).filter(([, v]) => v?.trim()).map(([k, v]) => `\n[${k.toUpperCase()}]\n${v}`).join('\n') || '(vacío — primera sesión)'}

Tu objetivo: mapear el estado completo de la empresa en una conversación fluida de ~30 minutos.

Áreas que DEBES cubrir en orden natural:
1. Contexto general → ¿A qué se dedica? ¿Cuántos empleados? ¿Dónde opera? ¿Facturación aproximada?
2. Dolores principales → ¿Qué procesos son un cuello de botella? ¿Qué te quita el sueño?
3. Objetivos 12 meses → ¿A dónde quieres llegar? ¿Qué métricas mejorar?
4. Organización → ¿Cómo están organizados? ¿Cuáles son las áreas y sus responsables?
5. Sistemas actuales → ¿Qué software usa el equipo? ¿ERP, CRM, herramientas operativas?
6. Presupuesto y expectativas → ¿Cuánto están dispuestos a invertir? ¿Qué esperan de MentorIA?

Cuando el usuario comparte información relevante, usa la herramienta \`actualizar_cubo\` INMEDIATAMENTE para documentarla en la sección correcta antes de hacer la siguiente pregunta.

Guía la conversación de forma natural. Empieza con algo abierto. No hagas todas las preguntas de golpe. Escucha, profundiza, y muévete a la siguiente área cuando la actual esté clara.

Responde siempre en español. Sé empático, directo y profesional.`,

  gerente: (empresa, cubo) => `Eres un consultor de MentorIA Systems conduciendo la sesión de diagnóstico con un gerente o jefe de área de "${empresa}".

Estado actual del cubo:
${Object.entries(cubo).filter(([, v]) => v?.trim()).map(([k, v]) => `\n[${k.toUpperCase()}]\n${v}`).join('\n') || '(vacío)'}

Tu objetivo: mapear el área específica del gerente con detalle operativo.

Temas a cubrir:
1. ¿Qué área lideras y cuál es su función principal?
2. ¿Cómo fluye el trabajo día a día? ¿Cuáles son los procesos clave?
3. ¿Cuántas personas tienes en tu equipo y qué hace cada quien?
4. ¿Qué herramientas y software usan?
5. ¿Dónde se pierde más tiempo? ¿Qué falla con frecuencia?
6. ¿Cómo miden el éxito del área?

Usa \`actualizar_cubo\` para documentar en \`areas_procesos\` y \`organigrama\`. Responde en español.`,

  operador: (empresa, cubo) => `Eres un consultor de MentorIA Systems tomando nota del trabajo diario de un colaborador de "${empresa}".

Estado actual del cubo:
${Object.entries(cubo).filter(([, v]) => v?.trim()).map(([k, v]) => `\n[${k.toUpperCase()}]\n${v}`).join('\n') || '(vacío)'}

Tu objetivo: entender exactamente qué hace esta persona y dónde pierde tiempo.

Preguntas clave:
1. ¿Cuál es tu puesto y en qué área trabajas?
2. Descríbeme un día típico de trabajo, paso a paso.
3. ¿Qué tarea haces más veces a la semana?
4. ¿Qué programas y apps usas? ¿Copias información entre sistemas?
5. ¿Qué proceso te frustra más? ¿Dónde se cometen más errores?
6. ¿Cuántas horas a la semana crees que dedicas a tareas repetitivas?

Usa \`actualizar_cubo\` para documentar en \`organigrama\` y \`sistemas\`. Responde en español.`,

  levantamiento: (empresa, cubo) => `Eres el asistente de sesión de diagnóstico de MentorIA Systems. Apoyas al asesor durante la sesión presencial con "${empresa}".

Estado actual del cubo:
${Object.entries(cubo).filter(([, v]) => v?.trim()).map(([k, v]) => `\n[${k.toUpperCase()}]\n${v}`).join('\n') || '(vacío — inicio de levantamiento)'}

Tu función:
- Documentar automáticamente todo lo que se va revelando en la conversación
- Hacer preguntas de seguimiento cuando el asesor lo indique
- Identificar brechas y oportunidades de automatización
- Sugerir preguntas de profundización cuando detectes algo interesante

Usa \`actualizar_cubo\` constantemente para capturar información en tiempo real. Cuando detectes una brecha o ineficiencia evidente, documéntala en la sección \`brechas\`. Cuando identifiques una automatización posible, documéntala en \`agentes\`.

Responde en español. Sé un copiloto activo del asesor.`,
};

function sse(res: Response, data: object) {
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
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    tipo: string;
    res: Response;
  }): Promise<void> {
    const { tenantId, clienteId, messages, tipo, res } = params;

    // SSE headers
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
      const tipoKey = (tipo in SYSTEM_PROMPTS) ? tipo : 'dg';
      const systemPrompt = SYSTEM_PROMPTS[tipoKey](cliente.empresa, currentCubo);

      let currentMessages: Anthropic.MessageParam[] = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

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
          sse(res, { type: 'text', text });
        });

        const finalMsg = await stream.finalMessage();

        if (finalMsg.stop_reason === 'end_turn') {
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
