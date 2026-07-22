import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';

// Días en los que se envía un mensaje de seguimiento tras el micro-diagnóstico
const FOLLOWUP_DAYS = [3, 7, 10, 14, 21, 30];

@Injectable()
export class SalesBotFollowUpService {
  private readonly logger = new Logger(SalesBotFollowUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionAdapter,
  ) {}

  // Se ejecuta cada día a las 9:00 AM hora servidor
  @Cron('0 9 * * *')
  async sendFollowUps(): Promise<void> {
    this.logger.log('FollowUp: iniciando ciclo diario de seguimiento');

    const convs = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT *,
        EXTRACT(DAY FROM NOW() - seguimiento_inicio) AS dias_transcurridos
      FROM "bot_conversations"
      WHERE seguimiento_activo = TRUE
        AND mode != 'HUMAN'
        AND seguimiento_inicio IS NOT NULL
        AND EXTRACT(DAY FROM NOW() - seguimiento_inicio) <= 30
    `);

    this.logger.log(`FollowUp: ${convs.length} conversaciones activas`);

    for (const conv of convs) {
      await this.processConversation(conv).catch((err) =>
        this.logger.error(`FollowUp error conv ${conv.id}: ${err.message}`),
      );
    }
  }

  private async processConversation(conv: any): Promise<void> {
    const daysElapsed = Math.floor(Number(conv.dias_transcurridos ?? 0));
    const lastSentDay: number = conv.etapa_seguimiento ?? 0;

    // Buscar el próximo umbral que ya pasó y aún no se envió
    const nextThreshold = FOLLOWUP_DAYS.find(
      (d) => d > lastSentDay && daysElapsed >= d,
    );
    if (!nextThreshold) return;

    // Cargar config del agente para este tenant
    const slot = await this.prisma.teamSlot.findFirst({
      where: {
        tenant_id: conv.tenant_id,
        type: 'AI_AGENT',
        agent_role: 'sales',
      },
      select: { agent_config: true },
    });
    const cfg = (slot?.agent_config as Record<string, any>) ?? {};

    // Cargar últimos 10 mensajes para dar contexto al LLM
    const messages = await this.prisma.botMessage.findMany({
      where: { conversation_id: conv.id },
      orderBy: { created_at: 'desc' },
      take: 10,
    });
    const historyText = messages
      .reverse()
      .map((m) => `${m.role === 'user' ? 'Prospecto' : cfg.nombre ?? 'Leo'}: ${m.content}`)
      .join('\n');

    const prospectData = this.parseJson(conv.prospect_data);

    // Generar mensaje de seguimiento personalizado
    const followUpMsg = await this.generateMessage({
      cfg,
      nextThreshold,
      historyText,
      prospectData,
    });

    if (!followUpMsg) {
      this.logger.warn(`FollowUp: no se pudo generar mensaje para conv ${conv.id}`);
      return;
    }

    // Enviar por WhatsApp
    await this.evolution.sendText(conv.instance_name, conv.jid, followUpMsg);

    // Guardar como mensaje del bot para que Leo tenga contexto en la próxima respuesta
    await this.prisma.botMessage.create({
      data: {
        conversation_id: conv.id,
        role: 'assistant',
        content: followUpMsg,
      },
    });

    // Actualizar etapa; si fue el día 30 desactivar seguimiento
    const isDone = nextThreshold >= 30;
    await this.prisma.$executeRawUnsafe(
      `UPDATE "bot_conversations"
       SET etapa_seguimiento = $1,
           seguimiento_activo = $2,
           last_message_at = NOW()
       WHERE id = $3`,
      nextThreshold,
      !isDone,
      conv.id,
    );

    this.logger.log(
      `FollowUp: día ${nextThreshold} enviado → conv ${conv.id} (${isDone ? 'ciclo cerrado' : 'continúa'})`,
    );
  }

  private async generateMessage(params: {
    cfg: Record<string, any>;
    nextThreshold: number;
    historyText: string;
    prospectData: Record<string, string>;
  }): Promise<string | null> {
    const { cfg, nextThreshold, historyText, prospectData } = params;

    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';
    if (!apiKey) return null;

    const agentName = cfg.nombre ?? 'Leo';
    const prospectName = prospectData.nombre ?? 'el prospecto';
    const prospectCompany = prospectData.empresa ?? 'su empresa';
    const tareaInstructions = cfg.tarea_seguimiento
      ? `\nDirectriz de seguimiento del agente:\n${cfg.tarea_seguimiento}`
      : '';

    const dayContext = this.getDayContext(nextThreshold);

    const prompt = `Eres ${agentName}, agente de ventas de ${cfg.actividad ?? 'este negocio'}.

Redactas un mensaje de WhatsApp de seguimiento para ${prospectName} de ${prospectCompany}.
Han pasado ${nextThreshold} días desde la última conversación.

Contexto de la conversación previa:
${historyText || '(sin historial disponible)'}
${tareaInstructions}

Instrucción para este mensaje (día ${nextThreshold}): ${dayContext}

Tu objetivo es que respondan y eventualmente agenden una reunión para resolver sus dudas.

Genera ÚNICAMENTE el cuerpo del mensaje. Sin comillas, sin explicaciones.
Máximo 3 líneas. Español conversacional y cálido. Sin frases genéricas de vendedor.`;

    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://flowdesk.io',
          'X-Title': 'FlowDesk FollowUp',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 200,
        }),
      });

      if (!res.ok) {
        this.logger.error(`OpenRouter FollowUp error ${res.status}`);
        return null;
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (err: any) {
      this.logger.error('generateMessage fetch error', err?.message);
      return null;
    }
  }

  private getDayContext(day: number): string {
    if (day <= 3)
      return 'Primer contacto post-diagnóstico. Sé amable y casual. Recuérdale quién eres y menciona algo del diagnóstico que hicieron juntos.';
    if (day <= 7)
      return 'Segundo mensaje. Menciona un beneficio concreto de nuestro servicio relevante para su situación. Pregunta si tuvo oportunidad de revisar el diagnóstico.';
    if (day <= 10)
      return 'Tercer contacto. Invita directamente a una llamada breve de 15-20 minutos para resolver dudas.';
    if (day <= 14)
      return 'Cuarto mensaje. Comparte un beneficio o resultado de otros clientes similares. Enfatiza el valor de la reunión para aclarar dudas.';
    if (day <= 21)
      return 'Quinto mensaje. Más directo. Propón una fecha/hora específica para la llamada.';
    return 'Último intento del ciclo. Mensaje de cierre cálido. Deja la puerta abierta para el futuro sin presionar.';
  }

  private parseJson(raw: string): Record<string, string> {
    try {
      return JSON.parse(raw ?? '{}');
    } catch {
      return {};
    }
  }
}
