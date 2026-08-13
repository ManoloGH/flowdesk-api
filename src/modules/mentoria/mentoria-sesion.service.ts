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

Estado actual del cubo:
${cuboState}

REGLA CRITICA: Usa actualizar_cubo SIN texto previo. Primero ejecuta TODAS las actualizaciones, luego escribe tu respuesta. NUNCA escribas "Dejame guardar" ni frases similares antes de usar la herramienta.

Despues de guardar:
1. Confirma brevemente que guardaste.
2. Indica que secciones faltan por completar.
3. Sugiere 2-3 preguntas para la proxima sesion.

Maximo 120 palabras. Responde en espanol.`;
}

@Injectable()
export class MentoriaSesionService {
  private readonly logger = new Logger(MentoriaSesionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async chatSesion(params: {
    tenantId: string;
    clienteId: string;
    message: string;
  }): Promise<{ text: string; cubo: Record<string, string>; sections_updated: string[] }> {
    const { tenantId, clienteId, message } = params;

    const cliente = await this.prisma.mentoriaCliente.findFirst({
      where: { id: clienteId, tenant_id: tenantId },
    });
    if (!cliente) throw new Error('Cliente no encontrado');

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('API key de Anthropic no configurada');

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    let currentCubo = (cliente.cubo as Record<string, string>) ?? {};

    const fullHistory: ChatEntry[] = (cliente.chat_history as ChatEntry[] | null) ?? [];
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

    for (let i = 0; i < 8; i++) {
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

    // Save to chat history (only if non-empty)
    if (message.trim() || assistantText.trim()) {
      const newHistory: ChatEntry[] = [
        ...fullHistory,
        { role: 'user', content: message, ts: new Date().toISOString() },
        ...(assistantText.trim()
          ? [{ role: 'assistant' as const, content: assistantText, ts: new Date().toISOString() }]
          : []),
      ];
      try {
        await this.prisma.mentoriaCliente.update({
          where: { id: clienteId },
          data: { chat_history: newHistory as any },
        });
      } catch (e) {
        this.logger.warn(`Error guardando chat_history: ${(e as any)?.message}`);
      }
    }

    return { text: assistantText, cubo: currentCubo, sections_updated: sectionsUpdated };
  }
}
