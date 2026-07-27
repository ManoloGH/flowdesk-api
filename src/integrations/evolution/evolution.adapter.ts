import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EvolutionAdapter {
  private readonly logger = new Logger(EvolutionAdapter.name);
  private readonly baseUrl = process.env.EVOLUTION_API_URL ?? '';
  private readonly apiKey = process.env.EVOLUTION_API_KEY ?? '';

  private headers() {
    return { apikey: this.apiKey, 'Content-Type': 'application/json' };
  }

  // Enviar mensaje de texto por WhatsApp
  async sendText(instanceName: string, to: string, text: string) {
    const number = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    const url = `${this.baseUrl}/message/sendText/${instanceName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ number, text }),
    });
    if (!res.ok) this.logger.error(`Evolution sendText error: ${res.status}`);
    return res.json();
  }

  // Enviar mensaje con imagen
  async sendImage(instanceName: string, to: string, imageUrl: string, caption?: string) {
    const number = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    const url = `${this.baseUrl}/message/sendMedia/${instanceName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ number, mediatype: 'image', media: imageUrl, caption }),
    });
    return res.json();
  }

  // Enviar media genérica (video, audio, documento)
  async sendMedia(instanceName: string, to: string, mediatype: 'video' | 'audio' | 'document', mediaUrl: string, caption?: string) {
    const number = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    const url = `${this.baseUrl}/message/sendMedia/${instanceName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ number, mediatype, media: mediaUrl, caption }),
    });
    if (!res.ok) this.logger.error(`Evolution sendMedia error: ${res.status}`);
    return res.json();
  }

  // Obtener instancias activas
  async getInstances() {
    const res = await fetch(`${this.baseUrl}/instance/fetchInstances`, { headers: this.headers() });
    return res.json();
  }

  // Estado de conexión de una instancia
  async getConnectionState(instanceName: string) {
    const res = await fetch(`${this.baseUrl}/instance/connectionState/${instanceName}`, {
      headers: this.headers(),
    });
    return res.json();
  }

  // Configurar webhook de una instancia para que apunte a FlowDesk
  async setWebhook(instanceName: string, webhookUrl: string): Promise<void> {
    const url = `${this.baseUrl}/webhook/set/${instanceName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        webhook_by_events: false,
        events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Evolution setWebhook error ${res.status}: ${body}`);
    } else {
      this.logger.log(`Evolution webhook configurado: ${instanceName} → ${webhookUrl}`);
    }
  }

  // Consultar la configuración de webhook de una instancia
  async getWebhook(instanceName: string): Promise<any> {
    const url = `${this.baseUrl}/webhook/find/${instanceName}`;
    const res = await fetch(url, { headers: this.headers() });
    return res.json();
  }

  // Enviar mensaje con botones interactivos de WhatsApp
  async sendButtons(instanceName: string, to: string, opts: {
    description: string;
    footer?: string;
    buttons: { id: string; text: string }[];
  }): Promise<void> {
    const number = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    const url = `${this.baseUrl}/message/sendButtons/${instanceName}`;
    const body = {
      number,
      buttonMessage: {
        description: opts.description,
        footer: opts.footer ?? '',
        buttons: opts.buttons.map(b => ({
          buttonId: b.id,
          buttonText: { displayText: b.text },
          type: 1,
        })),
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Fallback: send as plain text with options listed
      const text = `${opts.description}\n\n${opts.buttons.map(b => `▸ ${b.text}`).join('\n')}`;
      await this.sendText(instanceName, to, text);
    }
  }

  // Procesar webhook de Evolution API
  processWebhook(payload: any): {
    type: 'message' | 'status' | 'other';
    from?: string;
    content?: string;
    buttonId?: string;
    instance?: string;
  } {
    if (payload.event === 'messages.upsert' && payload.data?.key?.fromMe === false) {
      const msg = payload.data.message ?? {};
      // Respuesta a botón interactivo
      const buttonResponse = msg.buttonsResponseMessage?.selectedButtonId
        ?? msg.listResponseMessage?.singleSelectReply?.selectedRowId;
      const buttonText = msg.buttonsResponseMessage?.selectedDisplayText;
      // Texto normal
      const content = buttonText
        ?? msg.conversation
        ?? msg.extendedTextMessage?.text
        ?? (buttonResponse ? `[btn:${buttonResponse}]` : undefined);
      return {
        type: 'message',
        from: payload.data.key.remoteJid?.replace('@s.whatsapp.net', ''),
        content,
        buttonId: buttonResponse,
        instance: payload.instance,
      };
    }
    if (payload.event === 'messages.update') {
      return { type: 'status', instance: payload.instance };
    }
    return { type: 'other' };
  }
}
