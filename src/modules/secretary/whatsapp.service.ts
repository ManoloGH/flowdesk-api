import { Injectable, Logger } from '@nestjs/common';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly evolution: EvolutionAdapter) {}

  async send(instanceName: string, phone: string, text: string): Promise<void> {
    if (!instanceName || !process.env.EVOLUTION_API_URL) {
      this.logger.warn('Evolution API not configured — message not sent');
      return;
    }
    try {
      await this.evolution.sendText(instanceName, phone, text);
    } catch (err) {
      this.logger.error(`WhatsApp send failed: ${(err as Error).message}`);
    }
  }

  async sendList(instanceName: string, phone: string, items: string[], header?: string): Promise<void> {
    const text = [header, ...items].filter(Boolean).join('\n');
    await this.send(instanceName, phone, text);
  }

  parseIncoming(payload: unknown): { from: string; text: string; instance: string } | null {
    const parsed = this.evolution.processWebhook(payload);
    if (parsed.type !== 'message' || !parsed.from || !parsed.content) return null;
    return { from: parsed.from, text: parsed.content, instance: parsed.instance ?? '' };
  }
}
