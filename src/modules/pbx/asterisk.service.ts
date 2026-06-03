import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// ari-client no tiene @types publicados — usamos require con any
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ari = require('ari-client');

@Injectable()
export class AsteriskService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AsteriskService.name);
  private client: any = null;
  private stasisHandlers: Array<(event: any, channel: any) => Promise<void>> = [];

  async onModuleInit() {
    const url = process.env.ASTERISK_ARI_URL;
    if (!url) {
      this.logger.warn('ASTERISK_ARI_URL no configurado — PBX deshabilitado');
      return;
    }

    try {
      this.client = await ari.connect(
        url,
        process.env.ASTERISK_ARI_USER ?? 'flowdesk',
        process.env.ASTERISK_ARI_PASSWORD ?? 'flowdesk',
      );

      const appName = process.env.ASTERISK_APP ?? 'flowdesk';
      this.client.on('StasisStart', async (event: any, channel: any) => {
        for (const handler of this.stasisHandlers) {
          await handler(event, channel).catch(err =>
            this.logger.error(`Error en StasisStart handler: ${err.message}`),
          );
        }
      });

      this.client.start(appName);
      this.logger.log(`Conectado a Asterisk ARI en ${url}, app: ${appName}`);
    } catch (err: any) {
      this.logger.error(`No se pudo conectar a Asterisk: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    this.client?.stop?.();
  }

  // Registrar un handler para llamadas entrantes (StasisStart)
  onIncomingCall(handler: (event: any, channel: any) => Promise<void>) {
    this.stasisHandlers.push(handler);
  }

  // Responder un canal (atender la llamada)
  async answer(channel: any): Promise<void> {
    await channel.answer();
  }

  // Reproducir un archivo de audio en el canal
  async play(channel: any, sound: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const playback = this.client.Playback();
      channel.play({ media: `sound:${sound}` }, playback, (err: any) => {
        if (err) return reject(err);
        playback.on('PlaybackFinished', () => resolve());
      });
    });
  }

  // Transferir canal a extensión SIP
  async transferToExtension(channel: any, extension: string): Promise<void> {
    const context = process.env.ASTERISK_CONTEXT ?? 'from-internal';
    await channel.continueInDialplan({ context, extension, priority: 1 });
  }

  // Transferir canal a número externo (PSTN)
  async transferToExternal(channel: any, phoneNumber: string): Promise<void> {
    const trunk = process.env.ASTERISK_PSTN_TRUNK ?? 'SIP/trunk';
    await channel.continueInDialplan({
      context: 'from-internal',
      extension: `${trunk}/${phoneNumber}`,
      priority: 1,
    });
  }

  // Grabar audio del canal (para STT)
  async record(channel: any, filename: string, maxDurationSec = 15): Promise<string> {
    return new Promise((resolve, reject) => {
      const recording = this.client.LiveRecording();
      channel.record(
        {
          name: filename,
          format: 'wav',
          maxDurationSeconds: maxDurationSec,
          maxSilenceSeconds: 3,
          beep: false,
          ifExists: 'overwrite',
        },
        recording,
        (err: any) => {
          if (err) return reject(err);
          recording.on('RecordingFinished', () => resolve(`/var/spool/asterisk/recording/${filename}.wav`));
        },
      );
    });
  }

  // Colgar el canal
  async hangup(channel: any): Promise<void> {
    await channel.hangup().catch(() => {});
  }

  get isConnected(): boolean {
    return this.client !== null;
  }
}
