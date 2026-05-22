import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { KsfCategory, KsfLevel } from '@prisma/client';

export interface AlignmentIssue {
  type: 'missing_categories' | 'unset_levels' | 'non_unique_manager_ksfs' | 'below_minimum_count' | 'above_maximum_count';
  message: string;
  target_id: string;
  target_name: string;
}

const EXPECTED_CATEGORIES: Record<string, KsfCategory[]> = {
  owner:   [KsfCategory.OPERATIONAL],
  admin:   [KsfCategory.OPERATIONAL, KsfCategory.COORDINATION],
  manager: [KsfCategory.COORDINATION, KsfCategory.STRATEGIC],
  // owner del tenant es el CEO
};

@Injectable()
export class GoalAlignmentService {
  constructor(private prisma: PrismaService) {}

  async runOrgHealthCheck(tenantId: string): Promise<{ issues: AlignmentIssue[]; score: number }> {
    const issues: AlignmentIssue[] = [];

    const slots = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId },
      include: {
        ksf_factors: { where: { is_active: true } },
        direct_reports: { select: { id: true } },
      },
    });

    for (const slot of slots) {
      const ksfs = slot.ksf_factors;

      // Verifica límites de cantidad
      if (ksfs.length < 3) {
        issues.push({
          type: 'below_minimum_count',
          message: `Tiene ${ksfs.length} KSF(s). El mínimo recomendado es 3.`,
          target_id: slot.id,
          target_name: slot.name,
        });
      }
      if (ksfs.length > 7) {
        issues.push({
          type: 'above_maximum_count',
          message: `Tiene ${ksfs.length} KSFs. Selecciona solo los ${7} más críticos.`,
          target_id: slot.id,
          target_name: slot.name,
        });
      }

      // Verifica niveles definidos
      const unsetLevels = ksfs.filter(k =>
        k.minimum_level === 0 && k.satisfactory_level === 0 && k.outstanding_level === 0,
      );
      if (unsetLevels.length) {
        issues.push({
          type: 'unset_levels',
          message: `${unsetLevels.length} KSF(s) sin niveles negociados: ${unsetLevels.map(k => k.name).join(', ')}`,
          target_id: slot.id,
          target_name: slot.name,
        });
      }

      // Verifica unicidad para managers (role = manager | admin | owner)
      if (slot.direct_reports.length > 0 && ['manager', 'admin', 'owner'].includes(slot.role)) {
        const hasOnlyOperational = ksfs.length > 0 && ksfs.every(k => k.category === KsfCategory.OPERATIONAL);
        if (hasOnlyOperational) {
          issues.push({
            type: 'non_unique_manager_ksfs',
            message: `Todos sus KSFs son OPERATIONAL — igual que sus subordinados. Debe tener KSFs de COORDINATION o STRATEGIC únicos para su cargo.`,
            target_id: slot.id,
            target_name: slot.name,
          });
        }

        // Verifica que al menos un KSF sea STRATEGIC si tiene el rol de gerente senior
        if (slot.role === 'owner' || slot.role === 'admin') {
          const hasStrategic = ksfs.some(k => k.category === KsfCategory.STRATEGIC);
          if (!hasStrategic) {
            issues.push({
              type: 'missing_categories',
              message: `Sin KSFs de tipo STRATEGIC. Un directivo debe medir iniciativas orientadas al futuro.`,
              target_id: slot.id,
              target_name: slot.name,
            });
          }
        }
      }
    }

    // Score: 100 - (5 puntos por issue severo, 2 por leve)
    const severePenalty = issues.filter(i =>
      i.type === 'non_unique_manager_ksfs' || i.type === 'unset_levels',
    ).length * 5;
    const lightPenalty = issues.filter(i =>
      i.type !== 'non_unique_manager_ksfs' && i.type !== 'unset_levels',
    ).length * 2;

    const score = Math.max(0, 100 - severePenalty - lightPenalty);

    // Actualizar GoalSetupStatus para cada slot
    for (const slot of slots) {
      const slotIssues = issues.filter(i => i.target_id === slot.id);
      await this.prisma.goalSetupStatus.upsert({
        where: { team_slot_id: slot.id },
        create: {
          tenant_id: tenantId,
          target_level: KsfLevel.EMPLOYEE,
          target_id: slot.id,
          team_slot_id: slot.id,
          is_complete: slotIssues.length === 0,
          missing_categories: slotIssues
            .filter(i => i.type === 'missing_categories')
            .map(i => i.message),
          unset_goal_levels: slotIssues
            .filter(i => i.type === 'unset_levels')
            .map(i => i.target_id),
          has_unique_ksfs: !slotIssues.some(i => i.type === 'non_unique_manager_ksfs'),
          last_checked_at: new Date(),
        },
        update: {
          is_complete: slotIssues.length === 0,
          missing_categories: slotIssues.filter(i => i.type === 'missing_categories').map(i => i.message),
          unset_goal_levels: slotIssues.filter(i => i.type === 'unset_levels').map(i => i.target_id),
          has_unique_ksfs: !slotIssues.some(i => i.type === 'non_unique_manager_ksfs'),
          last_checked_at: new Date(),
        },
      });
    }

    return { issues, score };
  }

  async getSetupStatus(tenantId: string) {
    return this.prisma.goalSetupStatus.findMany({
      where: { tenant_id: tenantId },
      include: { team_slot: { select: { name: true, role: true } } },
    });
  }

  async getChronicProblems(tenantId: string) {
    const latestReports = await this.prisma.managementReport.findMany({
      where: { tenant_id: tenantId },
      orderBy: { week_start: 'desc' },
      distinct: ['manager_slot_id'],
      select: { zone3_chronic: true, manager_slot_id: true, week_start: true },
    });

    return latestReports.flatMap(r => {
      const zone3 = (r.zone3_chronic as any[]) ?? [];
      return zone3
        .filter((e: any) => e.escalation_tier === 2) // solo los más severos
        .map((e: any) => ({ ...e, manager_slot_id: r.manager_slot_id }));
    });
  }
}
