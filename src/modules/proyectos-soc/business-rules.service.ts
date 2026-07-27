import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AiProviderService } from '../../ai/ai-provider.service';
import { CreateBusinessRuleDto, UpdateBusinessRuleDto, ImportRulesFromTextDto } from './dto/business-rule.dto';

interface ExtractedRule {
  name: string;
  description: string;
  category: string;
  affected_areas: string[];
  related_systems: string[];
  original_text: string;
}

@Injectable()
export class BusinessRulesService {
  constructor(
    private prisma: PrismaService,
    private aiProvider: AiProviderService,
  ) {}

  findAll(tenantId: string, filters?: { category?: string; is_active?: boolean }) {
    return this.prisma.businessRule.findMany({
      where: {
        tenant_id: tenantId,
        ...(filters?.category ? { category: filters.category as any } : {}),
        ...(filters?.is_active !== undefined ? { is_active: filters.is_active } : {}),
      },
      orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const rule = await this.prisma.businessRule.findFirst({ where: { id, tenant_id: tenantId } });
    if (!rule) throw new NotFoundException('Regla no encontrada');
    return rule;
  }

  create(tenantId: string, dto: CreateBusinessRuleDto) {
    return this.prisma.businessRule.create({
      data: {
        tenant_id: tenantId,
        name: dto.name,
        description: dto.description,
        category: (dto.category as any) ?? 'REGLA_NEGOCIO',
        affected_areas: dto.affected_areas ?? [],
        related_systems: dto.related_systems ?? [],
        original_text: dto.original_text,
        source: 'MANUAL',
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateBusinessRuleDto) {
    await this.findOne(tenantId, id);
    return this.prisma.businessRule.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category as any,
        affected_areas: dto.affected_areas,
        related_systems: dto.related_systems,
        original_text: dto.original_text,
        is_active: dto.is_active,
      },
    });
  }

  async toggleActive(tenantId: string, id: string) {
    const rule = await this.findOne(tenantId, id);
    return this.prisma.businessRule.update({ where: { id }, data: { is_active: !rule.is_active } });
  }

  async delete(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.businessRule.delete({ where: { id } });
  }

  async importFromText(tenantId: string, dto: ImportRulesFromTextDto) {
    const systemPrompt = `Eres un extractor de reglas de negocio para empresas brokers de servicios financieros (créditos hipotecarios, PYME y seguros).

Analiza el texto dado y extrae todas las reglas de negocio, políticas, cálculos, validaciones y restricciones.

Responde SOLO con JSON válido con esta estructura:
{
  "rules": [
    {
      "name": "nombre corto de la regla",
      "description": "descripción clara y precisa",
      "category": "REGLA_NEGOCIO|POLITICA_OPERATIVA|CALCULO|VALIDACION_DATOS|RESTRICCION_SISTEMA|CUMPLIMIENTO|OTRO",
      "affected_areas": ["área1", "área2"],
      "related_systems": ["SISEC", "Excel", "otro"],
      "original_text": "texto exacto del que se extrajo"
    }
  ]
}`;

    const result = await this.aiProvider.chat({
      tenantId,
      agentRole: 'ceo',
      systemPrompt,
      messages: [{ role: 'user', content: `Extrae todas las reglas de negocio del siguiente contenido:\n\n${dto.content}` }],
      maxTokens: 4096,
    });

    const rawText = typeof result === 'string' ? result : (result as any).content ?? '';
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
    let extracted: { rules: ExtractedRule[] } = { rules: [] };
    if (jsonMatch?.[1]) {
      try { extracted = JSON.parse(jsonMatch[1].trim()); } catch { extracted = { rules: [] }; }
    }

    const rules = extracted.rules ?? [];
    const created = await Promise.all(
      rules.map((r) =>
        this.prisma.businessRule.create({
          data: {
            tenant_id: tenantId,
            name: r.name,
            description: r.description,
            category: (r.category as any) ?? 'REGLA_NEGOCIO',
            affected_areas: r.affected_areas ?? [],
            related_systems: r.related_systems ?? [],
            original_text: r.original_text,
            source_file_name: dto.source_file_name,
            source: 'ARCHIVO_IMPORTADO',
          },
        }),
      ),
    );

    return { imported: created.length, rules: created };
  }
}
