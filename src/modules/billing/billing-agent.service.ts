import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1200;
const MAX_ITERATIONS = 8;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_billing_config',
    description: 'Obtiene la configuración de facturación del tenant.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'upsert_billing_config',
    description: 'Configura o actualiza los datos de facturación.',
    input_schema: {
      type: 'object' as const,
      properties: {
        rfc:               { type: 'string' },
        legal_name:        { type: 'string' },
        fiscal_regime:     { type: 'string', description: 'Código régimen SAT, ej: 601, 612, 626' },
        tax_zip:           { type: 'string' },
        invoice_series:    { type: 'string' },
        payment_conditions:{ type: 'string', enum: ['PUE', 'PPD'] },
      },
    },
  },
  {
    name: 'get_pending_payments',
    description: 'Lista contactos con deals ganados sin factura registrada.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'create_invoice_task',
    description: 'Crea una tarea para generar una factura.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_name: { type: 'string' },
        amount:      { type: 'number' },
        concept:     { type: 'string' },
      },
      required: ['client_name', 'concept'],
    },
  },
];

@Injectable()
export class BillingAgentService {
  private readonly logger = new Logger(BillingAgentService.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(private readonly prisma: PrismaService) {}

  async chat(tenantId: string, ownerSlotId: string, message: string): Promise<string> {
    const config = await this.prisma.billingConfig.findUnique({ where: { tenant_id: tenantId } });

    const system = `Eres el Agente de Facturación. Ayudas con:
- Configuración de datos fiscales (RFC, régimen, CFDI)
- Seguimiento de pagos pendientes
- Creación de tareas de facturación
- Integración con Facturapi para CFDI en México

Estado actual: ${config?.enabled ? `✅ Configurado (RFC: ${config.rfc ?? 'pendiente'})` : '⚠️ Sin configurar — necesita RFC y datos fiscales'}

Responde en español, conciso.`;

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: message }];
    let response = await this.anthropic.messages.create({
      model: MODEL, max_tokens: MAX_TOKENS, system, tools: TOOLS, messages,
    });

    let i = 0;
    while (response.stop_reason === 'tool_use' && i++ < MAX_ITERATIONS) {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const r = await this.executeTool(tenantId, ownerSlotId, block.name, block.input as Record<string, unknown>);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(r) });
      }
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: results });
      response = await this.anthropic.messages.create({
        model: MODEL, max_tokens: MAX_TOKENS, system, tools: TOOLS, messages,
      });
    }

    const text = response.content.find(b => b.type === 'text');
    return text ? (text as Anthropic.TextBlock).text : 'Listo.';
  }

  private async executeTool(tenantId: string, ownerSlotId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
    try {
      switch (name) {
        case 'get_billing_config':
          return await this.prisma.billingConfig.findUnique({ where: { tenant_id: tenantId } }) ?? { configured: false };

        case 'upsert_billing_config':
          return await this.prisma.billingConfig.upsert({
            where: { tenant_id: tenantId },
            create: { tenant_id: tenantId, ...input, enabled: !!(input.rfc && input.fiscal_regime) },
            update: { ...input, enabled: !!(input.rfc && input.fiscal_regime), updated_at: new Date() },
          });

        case 'get_pending_payments':
          return await this.prisma.deal.findMany({
            where: { tenant_id: tenantId, status: 'won' },
            include: { contact: { select: { first_name: true, last_name: true } } },
            orderBy: { closed_at: 'desc' },
            take: 10,
          });

        case 'create_invoice_task':
          return await this.prisma.task.create({
            data: {
              tenant_id:   tenantId,
              owner_id:    ownerSlotId,
              title:       `Facturar: ${input.client_name} — ${input.concept}`,
              description: input.amount ? `Monto: $${Number(input.amount).toLocaleString()} MXN` : undefined,
              priority:    'high',
            },
          });

        default:
          return { error: `Tool desconocida: ${name}` };
      }
    } catch (err) {
      return { error: (err as Error).message };
    }
  }
}
