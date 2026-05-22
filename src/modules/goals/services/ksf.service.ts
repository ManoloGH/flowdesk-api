import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  CreateStrategicPurposeDto, CreateKsfRelationshipDto, CreateSuccessAreaDto,
  CreateKsfDto, UpdateKsfLevelsDto, CreateMilestoneDto, CompleteMilestoneDto,
  CreateEscalationConfigDto,
} from '../dto/goals.dto';
import { KsfLevel, KsfCategory } from '@prisma/client';

const KSF_MIN = 3;
const KSF_MAX = 7;

@Injectable()
export class KsfService {
  constructor(private prisma: PrismaService) {}

  // ─── Propósito estratégico ────────────────────────────────────────────────

  async upsertStrategicPurpose(tenantId: string, dto: CreateStrategicPurposeDto) {
    return this.prisma.strategicPurpose.upsert({
      where: { tenant_id: tenantId },
      create: { tenant_id: tenantId, ...dto },
      update: { ...dto },
    });
  }

  async getStrategicPurpose(tenantId: string) {
    return this.prisma.strategicPurpose.findUnique({
      where: { tenant_id: tenantId },
      include: { key_success_factors: { where: { level: KsfLevel.COMPANY, is_active: true } } },
    });
  }

  // ─── Relaciones (4 pasos: paso 1) ────────────────────────────────────────

  async createRelationship(tenantId: string, slotId: string, dto: CreateKsfRelationshipDto) {
    return this.prisma.ksfRelationship.create({
      data: { tenant_id: tenantId, team_slot_id: slotId, ...dto },
    });
  }

  async getRelationships(slotId: string) {
    return this.prisma.ksfRelationship.findMany({
      where: { team_slot_id: slotId },
      include: { success_areas: true },
    });
  }

  // ─── Áreas de éxito (4 pasos: paso 2) ───────────────────────────────────

  async createSuccessArea(tenantId: string, slotId: string, dto: CreateSuccessAreaDto) {
    return this.prisma.successArea.create({
      data: { tenant_id: tenantId, team_slot_id: slotId, ...dto },
    });
  }

  // ─── KSFs (4 pasos: paso 3 y 4) ─────────────────────────────────────────

  async createKsf(tenantId: string, dto: CreateKsfDto) {
    this.validateGoalLevels(dto.minimum_level, dto.satisfactory_level, dto.outstanding_level);

    const ownerTarget = dto.team_slot_id ?? dto.dept_id ?? tenantId;
    await this.checkKsfCountLimit(dto.level, ownerTarget, dto.team_slot_id);

    return this.prisma.keySuccessFactor.create({
      data: {
        tenant_id: tenantId,
        measurement_config: (dto.measurement_config ?? {}) as any,
        ...dto,
      },
    });
  }

  async updateKsfLevels(ksfId: string, tenantId: string, dto: UpdateKsfLevelsDto) {
    this.validateGoalLevels(dto.minimum_level, dto.satisfactory_level, dto.outstanding_level);
    return this.prisma.keySuccessFactor.update({
      where: { id: ksfId },
      data: dto,
    });
  }

  async getKsfsForSlot(slotId: string) {
    return this.prisma.keySuccessFactor.findMany({
      where: { team_slot_id: slotId, is_active: true },
      include: { milestones: true, parent_ksf: { select: { id: true, name: true } } },
      orderBy: { category: 'asc' },
    });
  }

  async getKsfsForDept(deptId: string) {
    return this.prisma.keySuccessFactor.findMany({
      where: { dept_id: deptId, is_active: true },
      include: { milestones: true },
      orderBy: { category: 'asc' },
    });
  }

  async getKsfsForCompany(tenantId: string) {
    return this.prisma.keySuccessFactor.findMany({
      where: { tenant_id: tenantId, level: KsfLevel.COMPANY, is_active: true },
      include: { milestones: true, child_ksfs: { where: { is_active: true } } },
    });
  }

  // ─── Hitos para KSFs estratégicos ────────────────────────────────────────

  async createMilestone(tenantId: string, dto: CreateMilestoneDto) {
    const ksf = await this.prisma.keySuccessFactor.findFirst({
      where: { id: dto.ksf_id, tenant_id: tenantId },
    });
    if (!ksf) throw new NotFoundException('KSF no encontrado');

    return this.prisma.ksfMilestone.create({
      data: {
        ksf_id: dto.ksf_id,
        name: dto.name,
        target_date: new Date(dto.target_date),
        notes: dto.notes,
      },
    });
  }

  async completeMilestone(milestoneId: string, dto: CompleteMilestoneDto) {
    return this.prisma.ksfMilestone.update({
      where: { id: milestoneId },
      data: { completed_at: new Date(), notes: dto.notes },
    });
  }

  // ─── Configuración de escalación ─────────────────────────────────────────

  async upsertEscalationConfig(tenantId: string, managerSlotId: string, dto: CreateEscalationConfigDto) {
    return this.prisma.escalationConfig.upsert({
      where: { manager_slot_id: managerSlotId },
      create: { tenant_id: tenantId, manager_slot_id: managerSlotId, ...dto },
      update: { ...dto },
    });
  }

  async getEscalationConfig(managerSlotId: string) {
    return this.prisma.escalationConfig.findUnique({
      where: { manager_slot_id: managerSlotId },
    });
  }

  // ─── Jerarquía org (reports_to) ──────────────────────────────────────────

  async setReportsTo(slotId: string, reportsToId: string | null) {
    if (reportsToId === slotId) throw new BadRequestException('Un slot no puede reportar a sí mismo');
    return this.prisma.teamSlot.update({
      where: { id: slotId },
      data: { reports_to_id: reportsToId },
    });
  }

  async getOrgLevel(slotId: string): Promise<number> {
    let level = 0;
    let currentId: string | null = slotId;
    while (currentId) {
      const slot = await this.prisma.teamSlot.findUnique({
        where: { id: currentId },
        select: { reports_to_id: true },
      });
      if (!slot?.reports_to_id) break;
      currentId = slot.reports_to_id;
      level++;
      if (level > 10) break; // evitar loops infinitos
    }
    return level;
  }

  // ─── Validaciones ─────────────────────────────────────────────────────────

  private validateGoalLevels(min: number, satisfactory: number, outstanding: number) {
    if (!(outstanding > satisfactory && satisfactory > min)) {
      throw new BadRequestException(
        'Los niveles deben estar en orden: outstanding > satisfactory > minimum',
      );
    }
    if (outstanding < satisfactory * 1.4) {
      throw new BadRequestException(
        'El nivel sobresaliente debe ser al menos 40% mayor que el satisfactorio para ser verdaderamente desafiante',
      );
    }
  }

  private async checkKsfCountLimit(level: KsfLevel, ownerId: string, slotId?: string) {
    const where = slotId
      ? { team_slot_id: slotId, is_active: true }
      : { dept_id: ownerId, is_active: true };

    const count = await this.prisma.keySuccessFactor.count({ where });
    if (count >= KSF_MAX) {
      throw new BadRequestException(
        `Máximo ${KSF_MAX} KSFs por persona/departamento. Selecciona solo los más críticos.`,
      );
    }
  }
}
