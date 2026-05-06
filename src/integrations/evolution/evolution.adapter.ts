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

  // Procesar webhook de Evolution API
  processWebhook(payload: any): {
    type: 'message' | 'status' | 'other';
    from?: string;
    content?: string;
    instance?: string;
  } {
    if (payload.event === 'messages.upsert' && payload.data?.key?.fromMe === false) {
      return {
        type: 'message',
        from: payload.data.key.remoteJid?.replace('@s.whatsapp.net', ''),
        content: payload.data.message?.conversation ?? payload.data.message?.extendedTextMessage?.text,
        instance: payload.instance,
      };
    }
    if (payload.event === 'messages.update') {
      return { type: 'status', instance: payload.instance };
    }
    return { type: 'other' };
  }
}
