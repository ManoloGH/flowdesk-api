import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { GoogleAdapter } from '../../integrations/google/google.adapter';

interface TranscriptSegment {
  speaker: number;
  text: string;
  start: number;
  end: number;
}

interface SaveMeetingDto {
  title?: string;
  platform?: string;
  started_at: string;
  ended_at?: string;
  transcript: TranscriptSegment[];
  speaker_map?: Record<string, string>;
}

@Injectable()
export class MeetingsService {
  private anthropic: Anthropic;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private enc: EncryptionService,
    private google: GoogleAdapter,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  getDeepgramKey() {
    return { key: this.config.get<string>('DEEPGRAM_API_KEY') ?? '' };
  }

  async save(tenantId: string, slotId: string, dto: SaveMeetingDto) {
    const startedAt = new Date(dto.started_at);
    const endedAt = dto.ended_at ? new Date(dto.ended_at) : new Date();
    const durationSecs = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);

    const meeting = await this.prisma.meeting.create({
      data: {
        tenant_id: tenantId,
        created_by: slotId,
        title: dto.title ?? 'Reunión',
        platform: dto.platform ?? 'otro',
        started_at: startedAt,
        ended_at: endedAt,
        duration_secs: durationSecs,
        transcript: dto.transcript as any,
        speaker_map: (dto.speaker_map ?? {}) as any,
      },
    });

    const { summary, action_items } = await this.generateSummary(
      dto.transcript,
      dto.speaker_map ?? {},
      dto.title,
    );

    const saved = await this.prisma.meeting.update({
      where: { id: meeting.id },
      data: { summary, action_items: action_items as any },
    });

    // Auto-upload a Google Drive (fire & forget — no bloquea la respuesta)
    this.uploadMeetingToDrive(saved, dto.transcript, dto.speaker_map ?? {}).catch(() => {});

    return saved;
  }

  async list(tenantId: string) {
    return this.prisma.meeting.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, title: true, platform: true,
        started_at: true, ended_at: true, duration_secs: true,
        summary: true, action_items: true, created_at: true,
      },
    });
  }

  async get(tenantId: string, id: string) {
    return this.prisma.meeting.findFirst({ where: { id, tenant_id: tenantId } });
  }

  // ─── Google Drive auto-upload ──────────────────────────────────────────────

  private async uploadMeetingToDrive(
    meeting: any,
    transcript: TranscriptSegment[],
    speakerMap: Record<string, string>,
  ) {
    const integration = await this.prisma.integration.findFirst({
      where: { tenant_id: meeting.tenant_id, owner_slot_id: meeting.created_by, provider: 'google', status: 'connected' },
    });
    if (!integration?.credentials_enc) return;

    let creds: any;
    try { creds = JSON.parse(this.enc.safeDecrypt(integration.credentials_enc)); } catch { return; }
    if (!creds.refresh_token) return;

    const accessToken = await this.google.getAccessToken(creds.refresh_token);
    if (!accessToken) return;

    const title = `Acta — ${meeting.title ?? 'Reunión'} ${new Date(meeting.started_at).toLocaleDateString('es-MX')}`;
    const body = this.buildDocContent(meeting, transcript, speakerMap);

    const result = await this.google.createMeetingDoc(accessToken, title, body);
    if (!result) return;

    await this.prisma.meeting.update({
      where: { id: meeting.id },
      data: { doc_url: result.url },
    }).catch(() => {});
  }

  private buildDocContent(
    meeting: any,
    transcript: TranscriptSegment[],
    speakerMap: Record<string, string>,
  ): string {
    const date = new Date(meeting.started_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const durMin = meeting.duration_secs ? Math.round(meeting.duration_secs / 60) : 0;
    const participants = Object.values(speakerMap).join(', ') || 'Sin etiquetar';
    const actionItems: string[] = Array.isArray(meeting.action_items) ? meeting.action_items : [];

    const lines: string[] = [
      `Fecha: ${date}`,
      `Duración: ${durMin} minutos`,
      `Plataforma: ${meeting.platform ?? 'otro'}`,
      `Participantes: ${participants}`,
      '',
      '════════════════════════════════════',
      'RESUMEN EJECUTIVO',
      '════════════════════════════════════',
      '',
      meeting.summary ?? 'Sin resumen.',
      '',
      '════════════════════════════════════',
      'ACCIONES A SEGUIR',
      '════════════════════════════════════',
      '',
      ...(actionItems.length ? actionItems.map(a => `• ${a}`) : ['• Sin acciones registradas.']),
      '',
      '════════════════════════════════════',
      'TRANSCRIPCIÓN COMPLETA',
      '════════════════════════════════════',
      '',
      ...transcript.map(seg => {
        const name = speakerMap[String(seg.speaker)] ?? `Speaker ${seg.speaker}`;
        return `[${Math.floor(seg.start / 60)}:${String(Math.floor(seg.start % 60)).padStart(2, '0')}] ${name}: ${seg.text}`;
      }),
    ];

    return lines.join('\n');
  }

  // ─── CEO summarizer ────────────────────────────────────────────────────────

  private async generateSummary(
    transcript: TranscriptSegment[],
    speakerMap: Record<string, string>,
    title?: string,
  ): Promise<{ summary: string; action_items: string[] }> {
    if (!transcript.length) return { summary: 'Sin contenido de audio.', action_items: [] };

    const text = transcript
      .map(seg => {
        const name = speakerMap[String(seg.speaker)] ?? `Speaker ${seg.speaker}`;
        return `${name}: ${seg.text}`;
      })
      .join('\n');

    try {
      const res = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: `Eres el CEO Agent de FlowDesk. Analiza esta transcripción de reunión${title ? ` ("${title}")` : ''} y genera un acta ejecutiva.

TRANSCRIPCIÓN:
${text}

Responde SOLO en JSON válido, sin texto extra:
{
  "summary": "Resumen ejecutivo de 3-5 oraciones con los puntos clave discutidos.",
  "action_items": [
    "Acción concreta 1 — Responsable (si se menciona)",
    "Acción concreta 2"
  ]
}`,
          },
        ],
      });

      const raw = res.content[0]?.type === 'text' ? res.content[0].text : '{}';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { summary: raw, action_items: [] };
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary ?? '',
        action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
      };
    } catch {
      return { summary: 'No se pudo generar el resumen.', action_items: [] };
    }
  }
}
