import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { CreateMemoryDto, QueryMemoriesDto } from './dto/agent-memory.dto';

@Injectable()
export class AgentMemoryService {
  private readonly anthropic: Anthropic;

  constructor(private prisma: PrismaService) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async store(tenantId: string, agentId: string, ownerSlotId: string | null, dto: CreateMemoryDto) {
    return this.prisma.agentMemory.create({
      data: {
        tenant_id: tenantId,
        agent_id: agentId,
        owner_slot_id: ownerSlotId ?? undefined,
        memory_type: dto.memory_type,
        content: dto.content,
        source_type: dto.source_type,
        source_id: dto.source_id,
        importance: dto.importance ?? 5,
        expires_at: dto.expires_at ? new Date(dto.expires_at) : undefined,
      },
    });
  }

  async query(tenantId: string, agentId: string, dto: QueryMemoriesDto) {
    const where: any = { tenant_id: tenantId, agent_id: agentId };
    if (dto.memory_type) where.memory_type = dto.memory_type;
    if (dto.query) where.content = { contains: dto.query, mode: 'insensitive' };

    const memories = await this.prisma.agentMemory.findMany({
      where,
      orderBy: [{ importance: 'desc' }, { last_accessed: 'desc' }, { created_at: 'desc' }],
      take: dto.limit ?? 20,
    });

    await this.updateAccessStats(memories.map((m: any) => m.id));
    return memories;
  }

  async getRelevantContext(agentId: string, ownerSlotId: string | null, query: string, limit = 12): Promise<string> {
    const where: any = { agent_id: agentId };
    if (ownerSlotId) where.owner_slot_id = ownerSlotId;

    const keywords = query
      .split(' ')
      .filter((w) => w.length > 3)
      .slice(0, 5);

    // Buscar memorias por palabras clave priorizando las más importantes
    const memories = await this.prisma.agentMemory.findMany({
      where: keywords.length
        ? { ...where, OR: keywords.map((k) => ({ content: { contains: k, mode: 'insensitive' as const } })) }
        : where,
      orderBy: [{ importance: 'desc' }, { access_count: 'desc' }, { updated_at: 'desc' }],
      take: limit,
    });

    if (memories.length === 0) return '';

    await this.updateAccessStats(memories.map((m: any) => m.id));

    const formatted = memories
      .map((m: any) => `[${m.memory_type.toUpperCase()}] ${m.content}`)
      .join('\n');

    return `\n\nMEMORIAS RELEVANTES:\n${formatted}\n`;
  }

  // Llama a Claude para extraer memorias estructuradas de una conversación terminada
  async extractFromConversation(
    tenantId: string,
    agentId: string,
    ownerSlotId: string,
    conversationText: string,
  ): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) return;

    try {
      // Detección rápida de correcciones antes de la extracción general
      await this.detectCorrections(tenantId, agentId, ownerSlotId, conversationText);

      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: `Eres un extractor de memorias para un agente IA. Analiza la conversación y extrae memorias útiles sobre el usuario y patrones de uso.
Responde SOLO con JSON válido con este formato:
{
  "memories": [
    { "memory_type": "factual|episodic|preference|goal|relationship|skill|pattern|gap", "content": "...", "importance": 1-10 }
  ]
}

Tipos a usar:
- factual: datos concretos del usuario (nombre, empresa, contexto)
- preference: cómo prefiere trabajar, comunicarse o recibir información
- goal: objetivos y metas que mencionó
- pattern: pregunta o solicitud recurrente que el usuario hace frecuentemente
- gap: tema donde el agente no pudo responder bien o el usuario quedó insatisfecho
- skill: capacidad o conocimiento que el usuario demostró tener
- episodic: evento o situación específica relevante

Extrae máximo 6 memorias. Prioriza correcciones, preferencias y patrones.`,
        messages: [{ role: 'user', content: `Conversación:\n${conversationText}` }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const { memories } = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(memories)) return;

      await Promise.all(
        memories.map((m: any) =>
          this.prisma.agentMemory.create({
            data: {
              tenant_id: tenantId,
              agent_id: agentId,
              owner_slot_id: ownerSlotId,
              memory_type: m.memory_type ?? 'episodic',
              content: m.content,
              source_type: 'conversation',
              importance: Math.min(10, Math.max(1, m.importance ?? 5)),
            },
          }),
        ),
      );
    } catch {
      // No bloquear el flujo si falla la extracción
    }
  }

  // Detecta si el usuario está corrigiendo al agente y guarda la corrección como memoria de alta prioridad
  private async detectCorrections(
    tenantId: string,
    agentId: string,
    ownerSlotId: string,
    conversationText: string,
  ): Promise<void> {
    const correctionSignals = [
      'eso está mal', 'eso estuvo mal', 'no me refería', 'te equivocaste', 'incorrecto',
      'no es así', 'estás confundiendo', 'no entendiste', 'no era eso', 'me malentendiste',
      'eso no es correcto', 'no, quiero decir', 'no, lo que quiero', 'está equivocado',
      'that\'s wrong', 'you misunderstood', 'incorrect', 'not what i meant',
    ];

    const lower = conversationText.toLowerCase();
    const hasCorrectionSignal = correctionSignals.some(s => lower.includes(s));
    if (!hasCorrectionSignal) return;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: `Analiza si el usuario está corrigiendo al agente. Si hay una corrección, extrae qué estuvo mal y cuál es la respuesta correcta.
Responde SOLO con JSON: { "is_correction": true/false, "what_was_wrong": "...", "correct_answer": "..." }
Si no hay corrección clara, responde { "is_correction": false }`,
        messages: [{ role: 'user', content: conversationText }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const result = JSON.parse(jsonMatch[0]);
      if (!result.is_correction) return;

      await this.prisma.agentMemory.create({
        data: {
          tenant_id: tenantId,
          agent_id: agentId,
          owner_slot_id: ownerSlotId,
          memory_type: 'correction',
          content: `CORRECCIÓN: ${result.what_was_wrong} → CORRECTO: ${result.correct_answer}`,
          source_type: 'conversation',
          importance: 9,
        },
      });
    } catch {
      // No bloquear el flujo
    }
  }

  async listByAgent(tenantId: string, agentId: string) {
    return this.prisma.agentMemory.findMany({
      where: { tenant_id: tenantId, agent_id: agentId },
      orderBy: [{ importance: 'desc' }, { created_at: 'desc' }],
    });
  }

  async delete(tenantId: string, agentId: string, memoryId: string) {
    return this.prisma.agentMemory.delete({
      where: { id: memoryId, tenant_id: tenantId, agent_id: agentId } as any,
    });
  }

  private async updateAccessStats(ids: string[]) {
    if (ids.length === 0) return;
    await this.prisma.agentMemory.updateMany({
      where: { id: { in: ids } },
      data: { last_accessed: new Date(), access_count: { increment: 1 } as any },
    });
  }
}
