import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UpsertCultureConfigDto, CreatePrincipleDto, UpdatePrincipleDto, CreateRitualDto, UpdateRitualDto } from './dto/culture.dto';

@Injectable()
export class CultureService {
  constructor(private prisma: PrismaService) {}

  // ── Config principal ────────────────────────────────────────────────────────

  async upsertConfig(tenantId: string, dto: UpsertCultureConfigDto) {
    const data: any = {
      purpose:              dto.purpose,
      problem_statement:    dto.problem_statement,
      desired_impact:       dto.desired_impact,
      operative_philosophy: dto.operative_philosophy ?? undefined,
      anti_values:          dto.anti_values ?? undefined,
      recognition_behaviors: dto.recognition_behaviors ?? undefined,
      recognition_awards:    dto.recognition_awards ?? undefined,
      feedback_framework:    dto.feedback_framework ? { stages: dto.feedback_framework } : undefined,
      internal_language:     dto.internal_language ?? undefined,
      ai_principles:         dto.ai_principles ?? undefined,
      ai_human_division:     (dto.ai_human_tasks || dto.ai_bot_tasks)
        ? { human_tasks: dto.ai_human_tasks ?? [], ai_tasks: dto.ai_bot_tasks ?? [] }
        : undefined,
    };

    // Eliminar claves undefined para no pisar campos existentes
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

    return this.prisma.cultureConfig.upsert({
      where:  { tenant_id: tenantId },
      create: { tenant_id: tenantId, ...data },
      update: data,
      include: { principles: { where: { is_active: true }, orderBy: { sort_order: 'asc' } },
                 rituals:    { where: { is_active: true }, orderBy: { sort_order: 'asc' } } },
    });
  }

  async getConfig(tenantId: string) {
    const config = await this.prisma.cultureConfig.findUnique({
      where: { tenant_id: tenantId },
      include: {
        principles: { where: { is_active: true }, orderBy: { sort_order: 'asc' } },
        rituals:    { where: { is_active: true }, orderBy: { sort_order: 'asc' } },
      },
    });
    return config ?? null;
  }

  async getFullCultureOS(tenantId: string) {
    const [config, purpose, ksfs] = await Promise.all([
      this.getConfig(tenantId),
      this.prisma.strategicPurpose.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.keySuccessFactor.findMany({
        where: { tenant_id: tenantId, is_active: true },
        select: { id: true, name: true, unit: true, level: true, category: true,
                  satisfactory_level: true, outstanding_level: true },
        orderBy: { level: 'asc' },
      }),
    ]);

    return { config, strategic_purpose: purpose, ksfs };
  }

  // ── Principios operativos ───────────────────────────────────────────────────

  async createPrinciple(tenantId: string, dto: CreatePrincipleDto) {
    const config = await this.getOrCreateConfig(tenantId);
    return this.prisma.culturePrinciple.create({
      data: {
        tenant_id:           tenantId,
        culture_id:          config.id,
        name:                dto.name,
        observable_behavior: dto.observable_behavior,
        sort_order:          dto.sort_order ?? 0,
      },
    });
  }

  async updatePrinciple(principleId: string, tenantId: string, dto: UpdatePrincipleDto) {
    const principle = await this.prisma.culturePrinciple.findFirst({
      where: { id: principleId, tenant_id: tenantId },
    });
    if (!principle) throw new NotFoundException('Principio no encontrado');
    return this.prisma.culturePrinciple.update({ where: { id: principleId }, data: dto });
  }

  async deletePrinciple(principleId: string, tenantId: string) {
    const principle = await this.prisma.culturePrinciple.findFirst({
      where: { id: principleId, tenant_id: tenantId },
    });
    if (!principle) throw new NotFoundException('Principio no encontrado');
    return this.prisma.culturePrinciple.update({
      where: { id: principleId },
      data: { is_active: false },
    });
  }

  // ── Rituales ────────────────────────────────────────────────────────────────

  async createRitual(tenantId: string, dto: CreateRitualDto) {
    const config = await this.getOrCreateConfig(tenantId);
    return this.prisma.cultureRitual.create({
      data: {
        tenant_id:       tenantId,
        culture_id:      config.id,
        name:            dto.name,
        ritual_type:     dto.ritual_type as any,
        duration_minutes: dto.duration_minutes,
        description:     dto.description,
        agenda:          dto.agenda ? ({ items: dto.agenda } as any) : undefined,
        sort_order:      dto.sort_order ?? 0,
      },
    });
  }

  async updateRitual(ritualId: string, tenantId: string, dto: UpdateRitualDto) {
    const ritual = await this.prisma.cultureRitual.findFirst({
      where: { id: ritualId, tenant_id: tenantId },
    });
    if (!ritual) throw new NotFoundException('Ritual no encontrado');

    const data: any = { ...dto };
    if (dto.agenda !== undefined) data.agenda = { items: dto.agenda };

    return this.prisma.cultureRitual.update({ where: { id: ritualId }, data });
  }

  async deleteRitual(ritualId: string, tenantId: string) {
    const ritual = await this.prisma.cultureRitual.findFirst({
      where: { id: ritualId, tenant_id: tenantId },
    });
    if (!ritual) throw new NotFoundException('Ritual no encontrado');
    return this.prisma.cultureRitual.update({
      where: { id: ritualId },
      data: { is_active: false },
    });
  }

  // ── Setup masivo desde onboarding ──────────────────────────────────────────

  async setupFromOnboarding(tenantId: string, input: {
    purpose?: string;
    problem_statement?: string;
    desired_impact?: string;
    operative_philosophy?: string[];
    anti_values?: { behavior: string; reason: string }[];
    ai_principles?: string[];
    ai_human_tasks?: string[];
    ai_bot_tasks?: string[];
    principles?: { name: string; observable_behavior: string }[];
    rituals?: {
      name: string;
      ritual_type: string;
      duration_minutes?: number;
      description?: string;
      agenda?: { topic: string; minutes?: number }[];
    }[];
  }) {
    // Crear o actualizar configuración base
    const config = await this.upsertConfig(tenantId, {
      purpose:              input.purpose,
      problem_statement:    input.problem_statement,
      desired_impact:       input.desired_impact,
      operative_philosophy: input.operative_philosophy,
      anti_values:          input.anti_values,
      ai_principles:        input.ai_principles,
      ai_human_tasks:       input.ai_human_tasks,
      ai_bot_tasks:         input.ai_bot_tasks,
    });

    // Crear principios
    const principles: any[] = [];
    for (let i = 0; i < (input.principles ?? []).length; i++) {
      const p = input.principles![i];
      try {
        const created = await this.prisma.culturePrinciple.create({
          data: {
            tenant_id: tenantId,
            culture_id: config.id,
            name: p.name,
            observable_behavior: p.observable_behavior,
            sort_order: i,
          },
        });
        principles.push({ id: created.id, name: created.name });
      } catch (e: any) {
        principles.push({ name: p.name, error: e.message });
      }
    }

    // Crear rituales
    const rituals: any[] = [];
    for (let i = 0; i < (input.rituals ?? []).length; i++) {
      const r = input.rituals![i];
      try {
        const created = await this.prisma.cultureRitual.create({
          data: {
            tenant_id:       tenantId,
            culture_id:      config.id,
            name:            r.name,
            ritual_type:     r.ritual_type as any,
            duration_minutes: r.duration_minutes,
            description:     r.description,
            agenda:          r.agenda ? { items: r.agenda } : undefined,
            sort_order:      i,
          },
        });
        rituals.push({ id: created.id, name: created.name, type: created.ritual_type });
      } catch (e: any) {
        rituals.push({ name: r.name, error: e.message });
      }
    }

    return { ok: true, config_id: config.id, principles, rituals };
  }

  // ── Helper ──────────────────────────────────────────────────────────────────

  private async getOrCreateConfig(tenantId: string) {
    return this.prisma.cultureConfig.upsert({
      where: { tenant_id: tenantId },
      create: { tenant_id: tenantId },
      update: {},
    });
  }
}
