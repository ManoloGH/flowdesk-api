import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from '../../ai/ai-provider.service';
import { AsteriskService } from './asterisk.service';
import { CallRouterService } from './call-router.service';
import { PrismaService } from '../../database/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AiCallHandlerService {
  private readonly logger = new Logger(AiCallHandlerService.name);

  constructor(
    private readonly asterisk: AsteriskService,
    private readonly aiProvider: AiProviderService,
    private readonly callRouter: CallRouterService,
    private readonly prisma: PrismaService,
  ) {}

  // Punto de entrada: nueva llamada entrante
  async handleIncomingCall(event: any, channel: any): Promise<void> {
    const fromNumber = channel.caller?.number ?? 'unknown';
    const instanceName = channel.name ?? '';

    // Resolver tenant por extensión destino
    const tenantId = await this.resolveTenant(channel);
    if (!tenantId) {
      this.logger.warn(`Llamada de ${fromNumber}: no se encontró tenant`);
      await this.asterisk.hangup(channel);
      return;
    }

    // Registrar llamada en BD
    const callRecord = await this.prisma.phoneCall.create({
      data: { tenant_id: tenantId, from_number: fromNumber, status: 'INCOMING' },
    });

    try {
      await this.asterisk.answer(channel);

      // 1. Saludo en TTS
      const greeting = await this.generateGreeting(tenantId);
      await this.playTTS(channel, greeting, tenantId);

      // 2. Grabar lo que dice el llamante
      const recordingPath = await this.asterisk.record(channel, `call_${callRecord.id}`);
      const userSpeech = await this.transcribe(recordingPath);

      // 3. Decidir enrutamiento
      const decision = await this.callRouter.route({ tenantId, fromNumber, greeting: userSpeech });

      await this.prisma.phoneCall.update({
        where: { id: callRecord.id },
        data: { ai_transcript: userSpeech, answered_at: new Date() },
      });

      if (decision.action === 'transfer_sip' && decision.extension) {
        // Avisar al llamante antes de transferir
        await this.playTTS(channel, 'Te voy a comunicar con nuestro equipo. Un momento.', tenantId);
        await this.asterisk.transferToExtension(channel, decision.extension);

        await this.prisma.phoneCall.update({
          where: { id: callRecord.id },
          data: {
            status: 'TRANSFERRED',
            to_extension: decision.extension,
            handled_by_id: decision.teamSlotId,
          },
        });
      } else if (decision.action === 'voicemail') {
        await this.playTTS(channel,
          'En este momento no hay agentes disponibles. Por favor deja tu mensaje después del tono.',
          tenantId,
        );
        const vmPath = await this.asterisk.record(channel, `vm_${callRecord.id}`, 60);
        const vmTranscript = await this.transcribe(vmPath);

        await this.prisma.phoneCall.update({
          where: { id: callRecord.id },
          data: { status: 'VOICEMAIL', ai_transcript: vmTranscript, ended_at: new Date() },
        });

        // Notificar al equipo por WhatsApp (si tienen número registrado)
        this.notifyVoicemail(tenantId, fromNumber, vmTranscript).catch(() => {});
      } else {
        // IA responde directamente
        await this.aiConversationLoop(channel, tenantId, fromNumber, callRecord.id, userSpeech);
      }
    } catch (err: any) {
      this.logger.error(`Error manejando llamada ${callRecord.id}: ${err.message}`);
      await this.asterisk.hangup(channel);
      await this.prisma.phoneCall.update({
        where: { id: callRecord.id },
        data: { status: 'MISSED', ended_at: new Date() },
      });
    }
  }

  // Loop de conversación con IA (hasta 3 turnos)
  private async aiConversationLoop(
    channel: any,
    tenantId: string,
    fromNumber: string,
    callId: string,
    firstMessage: string,
  ): Promise<void> {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: firstMessage },
    ];

    for (let turn = 0; turn < 3; turn++) {
      const result = await this.aiProvider.chat({
        tenantId,
        systemPrompt: `Eres el asistente telefónico de la empresa. Responde de forma muy breve (2-3 oraciones máximo) para una llamada telefónica. Responde en español.`,
        messages: history,
        maxTokens: 150,
      });

      history.push({ role: 'assistant', content: result.response });
      await this.playTTS(channel, result.response, tenantId);

      // Grabar respuesta del llamante
      const recordingPath = await this.asterisk.record(channel, `call_${callId}_turn${turn}`);
      const userSpeech = await this.transcribe(recordingPath);

      if (!userSpeech || userSpeech.toLowerCase().includes('adiós') || userSpeech.toLowerCase().includes('gracias')) {
        await this.playTTS(channel, 'Hasta luego, que tenga buen día.', tenantId);
        break;
      }

      history.push({ role: 'user', content: userSpeech });
    }

    await this.asterisk.hangup(channel);
    await this.prisma.phoneCall.update({
      where: { id: callId },
      data: { status: 'COMPLETED', ended_at: new Date() },
    });
  }

  // ─── STT: Transcripción de audio ────────────────────────────────────────────

  private async transcribe(audioPath: string): Promise<string> {
    const whisperUrl = process.env.WHISPER_URL;

    if (whisperUrl) {
      // Whisper local (openai/whisper-asr-webservice)
      try {
        if (!fs.existsSync(audioPath)) return '';
        const formData = new FormData();
        const blob = new Blob([fs.readFileSync(audioPath)], { type: 'audio/wav' });
        formData.append('audio_file', blob, path.basename(audioPath));

        const res = await fetch(`${whisperUrl}/asr?task=transcribe&language=es`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json() as any;
        return data.text?.trim() ?? '';
      } catch (err: any) {
        this.logger.warn(`Whisper error: ${err.message}`);
        return '';
      }
    }

    if (process.env.DEEPGRAM_API_KEY) {
      // Deepgram como fallback
      try {
        if (!fs.existsSync(audioPath)) return '';
        const audioBuffer = fs.readFileSync(audioPath);
        const res = await fetch('https://api.deepgram.com/v1/listen?language=es&model=nova-2', {
          method: 'POST',
          headers: {
            Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
            'Content-Type': 'audio/wav',
          },
          body: audioBuffer,
        });
        const data = await res.json() as any;
        return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
      } catch {
        return '';
      }
    }

    return '';
  }

  // ─── TTS: Texto a voz ───────────────────────────────────────────────────────

  private async playTTS(channel: any, text: string, tenantId: string): Promise<void> {
    const piperUrl = process.env.PIPER_URL;

    if (piperUrl) {
      try {
        const res = await fetch(`${piperUrl}/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: 'es_MX-claude-medium' }),
        });
        const audioBuffer = Buffer.from(await res.arrayBuffer());
        const tmpFile = `/tmp/tts_${Date.now()}.wav`;
        fs.writeFileSync(tmpFile, audioBuffer);
        await this.asterisk.play(channel, tmpFile).catch(() => {});
        fs.unlink(tmpFile, () => {});
        return;
      } catch (err: any) {
        this.logger.warn(`Piper TTS error: ${err.message}`);
      }
    }

    // Fallback: reproducir archivo de audio pregrabado si existe
    await this.asterisk.play(channel, 'vm-sorry').catch(() => {});
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async generateGreeting(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return `Bienvenido a ${tenant?.name ?? 'nuestra empresa'}. ¿En qué le puedo ayudar?`;
  }

  private async resolveTenant(channel: any): Promise<string | null> {
    // El dialplan de Asterisk pone el tenant en la variable de canal
    const tenantId = channel.channelvars?.TENANT_ID;
    if (tenantId) return tenantId;

    // Fallback: primer tenant activo (instalaciones de un solo tenant)
    const tenant = await this.prisma.tenant.findFirst({
      where: { status: 'active' },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  private async notifyVoicemail(tenantId: string, fromNumber: string, transcript: string): Promise<void> {
    // Notificar por WhatsApp a empleados con número registrado
    const managers = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, type: 'HUMAN', role: { in: ['owner', 'admin', 'manager'] }, whatsapp_phone: { not: null } },
      select: { whatsapp_phone: true },
    });

    const msg = `📞 *Voicemail nuevo*\nDe: ${fromNumber}\nMensaje: ${transcript || '(sin transcripción)'}`;
    this.logger.log(`Voicemail a notificar: ${msg} → ${managers.length} contactos`);
  }
}
