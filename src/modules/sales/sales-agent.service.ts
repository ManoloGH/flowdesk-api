import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { SalesService } from './sales.service';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1200;
const MAX_ITERATIONS = 8;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_pipeline_summary',
    description: 'Resumen del pipeline: deals abiertos, valor total, deals estancados.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_deals',
    description: 'Lista deals del pipeline con filtros opcionales.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['open', 'won', 'lost'] },
        staled_days: { type: 'number', description: 'Deals sin actividad en N días' },
      },
    },
  },
  {
    name: 'create_deal',
    description: 'Crea un nuevo deal en el pipeline.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact_name: { type: 'string' },
        title:        { type: 'string' },
        value:        { type: 'number' },
        notes:        { type: 'string' },
      },
      required: ['contact_name', 'title'],
    },
  },
  {
    name: 'close_deal',
    description: 'Cierra un deal como ganado o perdido.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id: { type: 'string' },
        won:     { type: 'boolean' },
        notes:   { type: 'string' },
      },
      required: ['deal_id', 'won'],
    },
  },
  {
    name: 'create_followup_task',
    description: 'Crea una tarea de seguimiento para un deal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_title:  { type: 'string' },
        description: { type: 'string' },
        due_date:    { type: 'string', description: 'ISO date' },
      },
      required: ['deal_title', 'description'],
    },
  },
];

@Injectable()
export class SalesAgentService {
  private readonly logger = new Logger(SalesAgentService.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
  ) {}

  async chat(tenantId: string, ownerSlotId: string, message: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    const summary = await this.sales.getSummary(tenantId);

    const system = `Eres el Agente Comercial de ${tenant?.name ?? 'la empresa'}.
Tu trabajo: gestionar el pipeline de ventas, hacer seguimiento de deals y alertar cuando hay oportunidades en riesgo.

ESTADO ACTUAL DEL PIPELINE:
• Deals abiertos: ${summary.open} (valor: $${summary.pipeline_value.toLocaleString()} MXN)
• Ganados: ${summary.won} ($${summary.won_value.toLocaleString()} MXN)
• Estancados (>7 días): ${summary.staled}

REGLAS:
- El diagnóstico es la puerta de entrada — antes de hablar de FlowDesk o agentes, habla del diagnóstico
- Nunca cierras un deal sin confirmación del Founder
- Alertas de deals estancados en el morning brief
- Responde en español, directo, máximo 4 líneas`;

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
    return text ? (text as Anthropic.TextBlock).text : 'Acción completada.';
  }

  private async executeTool(tenantId: string, ownerSlotId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
    try {
      switch (name) {
        case 'get_pipeline_summary':
          return await this.sales.getSummary(tenantId);

        case 'get_deals': {
          if (input.staled_days) return await this.sales.getStaledDeals(tenantId, input.staled_days as number);
          return await this.prisma.deal.findMany({
            where: { tenant_id: tenantId, ...(input.status ? { status: input.status as string } : {}) },
            include: { contact: { select: { first_name: true, last_name: true } }, stage: { select: { name: true } } },
            orderBy: { updated_at: 'desc' },
            take: 15,
          });
        }

        case 'create_deal': {
          const pipelines = await this.prisma.pipeline.findMany({
            where: { tenant_id: tenantId, is_active: true },
            include: { stages: { orderBy: { order_index: 'asc' }, take: 1 } },
            take: 1,
          });
          if (!pipelines.length || !pipelines[0].stages.length) return { error: 'No hay pipeline configurado' };

          let contact = await this.prisma.contact.findFirst({
            where: { tenant_id: tenantId, first_name: { contains: input.contact_name as string, mode: 'insensitive' } },
          });
          if (!contact) {
            contact = await this.prisma.contact.create({
              data: { tenant_id: tenantId, first_name: input.contact_name as string, status: 'prospect', owner_slot_id: ownerSlotId },
            });
          }

          return await this.sales.createDeal(tenantId, ownerSlotId, {
            contact_id:  contact.id,
            pipeline_id: pipelines[0].id,
            stage_id:    pipelines[0].stages[0].id,
            title:       input.title as string,
            value:       input.value as number | undefined,
            notes:       input.notes as string | undefined,
          });
        }

        case 'close_deal':
          return await this.sales.closeDeal(tenantId, input.deal_id as string, input.won as boolean, input.notes as string | undefined);

        case 'create_followup_task': {
          return await this.prisma.task.create({
            data: {
              tenant_id:   tenantId,
              owner_id:    ownerSlotId,
              title:       `Seguimiento: ${input.deal_title}`,
              description: input.description as string,
              priority:    'high',
              due_date:    input.due_date ? new Date(input.due_date as string) : null,
            },
          });
        }

        default:
          return { error: `Tool desconocida: ${name}` };
      }
    } catch (err) {
      this.logger.error(`Sales tool ${name}: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  }
}
