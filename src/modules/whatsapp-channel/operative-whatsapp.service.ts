import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';
import { WhatsAppFormatterService } from './whatsapp-formatter.service';

// ─── Cédula de resultados: flujo guiado de 3 preguntas ───────────────────────

interface SessionState {
  step: 1 | 2 | 3 | 'done';
  hice?: string;
  cuanto?: string;
  updatedAt: number;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

@Injectable()
export class OperativeWhatsAppService {
  private readonly logger = new Logger(OperativeWhatsAppService.name);
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionAdapter,
    private readonly formatter: WhatsAppFormatterService,
  ) {}

  async handle(params: {
    phone: string;
    message: string;
    tenantId: string;
    teamSlot: any;
    instanceName: string;
  }): Promise<void> {
    const { phone, message, tenantId, teamSlot, instanceName } = params;
    const jid = `${phone}@s.whatsapp.net`;
    const sessionKey = `${tenantId}:${teamSlot.id}`;

    this.cleanExpiredSessions();

    let session = this.sessions.get(sessionKey);
    const msg = message.trim().toLowerCase();

    // Comando para reiniciar el reporte
    if (msg === 'reporte' || msg === 'cédula' || msg === 'cedula' || !session || session.step === 'done') {
      session = { step: 1, updatedAt: Date.now() };
      this.sessions.set(sessionKey, session);
      await this.send(instanceName, jid,
        `¡Hola ${teamSlot.name}! 📋 *Cédula de resultados del día*\n\n*Paso 1 de 3*\n¿Qué realizaste hoy?\n\n_Describe brevemente tus actividades principales._`
      );
      return;
    }

    session.updatedAt = Date.now();

    if (session.step === 1) {
      session.hice   = message;
      session.step   = 2;
      this.sessions.set(sessionKey, session);
      await this.send(instanceName, jid,
        `✅ Registrado.\n\n*Paso 2 de 3*\n¿Cuántas unidades, tareas o avances completaste?\n\n_Ej: 5 visitas, 3 instalaciones, 80% del área_`
      );
      return;
    }

    if (session.step === 2) {
      session.cuanto = message;
      session.step   = 3;
      this.sessions.set(sessionKey, session);
      await this.send(instanceName, jid,
        `✅ Registrado.\n\n*Paso 3 de 3 (último)*\n¿Hubo alguna novedad, incidente o bloqueante?\n\n_Si todo estuvo bien, responde: ninguno_`
      );
      return;
    }

    if (session.step === 3) {
      const novedades = message.toLowerCase() === 'ninguno' ? null : message;
      session.step    = 'done';
      this.sessions.set(sessionKey, session);

      await this.saveReport(tenantId, teamSlot.id, session.hice!, session.cuanto!, novedades);

      await this.send(instanceName, jid,
        `✅ *Cédula guardada correctamente*\n\nResumen:\n📌 Hice: ${session.hice}\n📊 Cuánto: ${session.cuanto}${novedades ? `\n⚠ Novedades: ${novedades}` : ''}\n\nTu gerente puede verlo en FlowDesk. ¡Buen trabajo hoy! 💪\n\n_Escribe *reporte* mañana para registrar el siguiente día._`
      );
      return;
    }
  }

  // Enviar cédula proactiva desde el sistema (cron o trigger del gerente)
  async sendDailyPrompt(params: {
    tenantId: string;
    slotId: string;
    instanceName: string;
  }): Promise<void> {
    const slot = await this.prisma.teamSlot.findUnique({
      where: { id: params.slotId },
      select: { name: true, whatsapp_phone: true },
    });
    if (!slot?.whatsapp_phone) return;

    const jid = `${slot.whatsapp_phone}@s.whatsapp.net`;
    const sessionKey = `${params.tenantId}:${params.slotId}`;
    this.sessions.set(sessionKey, { step: 1, updatedAt: Date.now() });

    await this.send(params.instanceName, jid,
      `¡Hola ${slot.name}! 📋 Es hora de tu *cédula de resultados diarios*.\n\n*Paso 1 de 3*\n¿Qué realizaste hoy?\n\n_Describe brevemente tus actividades principales._`
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async saveReport(tenantId: string, slotId: string, hice: string, cuanto: string, novedades: string | null) {
    const today = new Date().toISOString().split('T')[0];
    const content = { hice, cuanto, novedades, date: today, source: 'whatsapp' };

    const existing = await this.prisma.workReport.findFirst({
      where: { tenant_id: tenantId, slot_id: slotId, period: 'daily' },
      orderBy: { created_at: 'desc' },
    });

    if (existing) {
      await this.prisma.workReport.update({ where: { id: existing.id }, data: { content } });
    } else {
      await this.prisma.workReport.create({ data: { tenant_id: tenantId, slot_id: slotId, period: 'daily', content } });
    }

    this.logger.log(`Cédula guardada para slot ${slotId}`);
  }

  private async send(instanceName: string, jid: string, text: string): Promise<void> {
    await this.evolution.sendText(instanceName, jid, this.formatter.format(text));
  }

  private cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.updatedAt > SESSION_TTL_MS) this.sessions.delete(key);
    }
  }
}
