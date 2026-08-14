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

const CUBO_KEYS = ['contexto', 'areas_procesos', 'organigrama', 'sistemas', 'brechas', 'agentes'] as const;

function buildSystemPrompt(empresa: string, cubo: Record<string, string>): string {
  const cuboState = Object.entries(cubo)
    .filter(([k, v]) => CUBO_KEYS.includes(k as any) && v?.trim())
    .map(([k, v]) => `[${k.toUpperCase()}]\n${v}`)
    .join('\n\n') || '(vacio - primera sesion)';

  return `Eres el asistente de diagnostico del asesor de MentorIA Systems. Tu interlocutor es SIEMPRE el asesor, nunca el cliente.

El asesor conduce entrevistas con "${empresa}" y te comparte lo que le dijo el cliente.

METODOLOGIA — documenta cada proceso en 3 etapas:
1. SOLICITUD: quien lo activa, por donde llega, que informacion dan.
2. PROCESO paso a paso: que data se genera, donde se registra, quien, desde donde trabaja, en que dispositivo.
3. ENTREGA: que se entrega, donde queda el registro, que exactamente se anota.

Estado actual del cubo:
${cuboState}

INSTRUCCIONES DE RESPUESTA:
1. Responde al asesor en maximo 120 palabras en espanol.
2. Confirma lo que ya quedo documentado y lo que falta.
3. Haz 2 preguntas concretas para completar el mapeo del proceso.
4. Si hay informacion nueva que guardar, incluye AL FINAL (despues de tu texto) uno o mas bloques asi:
[CUBO:seccion]contenido completo actualizado de la seccion[/CUBO]
Secciones: contexto | areas_procesos | organigrama | sistemas | brechas | agentes
El contenido debe ser el texto COMPLETO de la seccion (incluye lo anterior + lo nuevo).
Solo incluye bloques [CUBO] cuando hay informacion nueva del cliente.`;
}

function parseCuboBlocks(text: string): { cleanText: string; updates: Array<{ seccion: CuboKey; contenido: string }> } {
  const updates: Array<{ seccion: CuboKey; contenido: string }> = [];
  const regex = /\[CUBO:(\w+)\]([\s\S]*?)\[\/CUBO\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const seccion = match[1] as CuboKey;
    if (CUBO_KEYS.includes(seccion)) {
      updates.push({ seccion, contenido: match[2].trim() });
    }
  }
  const cleanText = text.replace(/\[CUBO:\w+\][\s\S]*?\[\/CUBO\]/g, '').trim();
  return { cleanText, updates };
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

    const anthropic = new Anthropic({ apiKey: anthropicKey, timeout: 55_000 });
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

    // Last 6 messages (~3 exchanges), only non-empty content
    const recentHistory = fullHistory
      .slice(-6)
      .filter(m => m.content?.trim());

    const messages: Anthropic.MessageParam[] = [
      ...recentHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message },
    ];

    const systemPrompt = buildSystemPrompt(cliente.empresa, currentCubo);
    let assistantText = '';
    const sectionsUpdated: string[] = [];

    try {
      // Single API call — no tool use loop
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: systemPrompt,
        messages,
      });

      const rawText = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '';
      const { cleanText, updates } = parseCuboBlocks(rawText);
      assistantText = cleanText;

      // Apply cubo updates from parsed blocks
      for (const { seccion, contenido } of updates) {
        currentCubo = { ...currentCubo, [seccion]: contenido };
        sectionsUpdated.push(seccion);
      }
      if (updates.length > 0) {
        try {
          await this.prisma.mentoriaCliente.update({
            where: { id: clienteId },
            data: { cubo: currentCubo },
          });
        } catch (e) {
          this.logger.warn(`Error guardando cubo: ${(e as any)?.message}`);
        }
      }
    } catch (aiError: any) {
      const isTimeout = aiError?.name === 'APIConnectionTimeoutError' || aiError?.name === 'APITimeoutError' || aiError?.code === 'ETIMEDOUT';
      assistantText = isTimeout
        ? 'El modelo tardó demasiado. Intenta de nuevo.'
        : `Error al contactar al modelo: ${aiError?.message ?? 'error desconocido'}`;
      this.logger.error(`Error Anthropic en chatSesion: ${aiError?.message}`);
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
    sesionId?: string;
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
    // Only include known cubo sections (exclude internal fields like __cuestionarios_globales)
    const cuboText = Object.entries(cubo)
      .filter(([k, v]) => CUBO_KEYS.includes(k as any) && v?.trim())
      .map(([k, v]) => `[${k.toUpperCase()}]\n${v}`)
      .join('\n\n') || '(sin información en el cubo aún)';

    // Session context is optional
    let sesionContexto = '';
    let interlocutorLabel = 'el equipo directivo';
    if (sesionId) {
      const sesiones = ((cliente as any).sesiones_diagnostico ?? []) as any[];
      const sesion = sesiones.find((s: any) => s.id === sesionId);
      if (sesion) {
        interlocutorLabel = sesion.interlocutor ?? interlocutorLabel;
        const sesionText = ((sesion.mensajes ?? []) as any[])
          .map((m: any) => `${m.role === 'user' ? 'Asesor' : 'IA'}: ${m.content}`)
          .join('\n');
        if (sesionText.trim()) {
          sesionContexto = `\nSESIÓN CON ${(sesion.cargo ?? 'DIRECTIVO').toUpperCase()} — ${sesion.interlocutor}:\n${sesionText}`;
        }
      }
    }

    const rolLabel = rolDestino === 'gerente' ? 'GERENTES' : 'OPERADORES';

    const prompt = `Eres experto en diagnóstico organizacional. Basándote en:

CONTEXTO DEL CLIENTE (${cliente.empresa}):
${cuboText}
${sesionContexto}

Genera un cuestionario personalizado para los ${rolLabel} del área de ${area} en ${cliente.empresa}.

INSTRUCCIONES:
1. Usa la terminología y procesos reales de ${cliente.empresa} que aparecen en el cubo
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

Genera entre 12 y 18 preguntas. Sé específico con la empresa y el área.`;

    const anthropic = new Anthropic({ apiKey: anthropicKey, timeout: 55_000 });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: 'Generates organizational diagnostic questionnaires. Respond ONLY with valid JSON. No markdown, no explanation.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '';
    this.logger.debug(`Cuestionario raw response (${text.length} chars): ${text.substring(0, 200)}`);
    let preguntas: any[] = [];
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`Sin bloque JSON en respuesta (${text.length} chars)`);
      const parsed = JSON.parse(match[0]);
      preguntas = parsed.preguntas ?? [];
      if (preguntas.length === 0) throw new Error('JSON válido pero sin preguntas');
    } catch (parseErr: any) {
      this.logger.error(`Error parseando cuestionario: ${parseErr.message} | texto: ${text.substring(0, 500)}`);
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

    // Save to session if sesionId provided, otherwise save to client-level list
    if (sesionId) {
      try {
        await this.mentoriaService.saveCuestionarioGenerado(clienteId, sesionId, cuestionario);
      } catch (e) {
        this.logger.warn(`Error guardando cuestionario en sesión: ${(e as any)?.message}`);
      }
    } else {
      try {
        await this.mentoriaService.saveCuestionarioGlobal(clienteId, cuestionario);
      } catch (e) {
        this.logger.warn(`Error guardando cuestionario global: ${(e as any)?.message}`);
      }
    }

    return cuestionario;
  }
}
