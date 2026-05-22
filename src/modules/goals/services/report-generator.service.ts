import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { MeasurementCalculatorService } from './measurement-calculator.service';
import { KsfLevel, KsfStatus } from '@prisma/client';
import { startOfWeek, endOfWeek, subWeeks, startOfMonth, subMonths } from 'date-fns';

const ESCALATION_DEFAULT = { threshold1_periods: 4, threshold1_levels: 2, threshold2_periods: 8, threshold2_levels: 3 };

@Injectable()
export class ReportGeneratorService {
  constructor(
    private prisma: PrismaService,
    private calculator: MeasurementCalculatorService,
  ) {}

  // ─── Medición de un KSF ──────────────────────────────────────────────────

  async measureKsf(ksfId: string, period: Date) {
    const ksf = await this.prisma.keySuccessFactor.findUniqueOrThrow({
      where: { id: ksfId },
    });

    const ownerId = ksf.team_slot_id ?? ksf.dept_id ?? ksf.tenant_id;
    const config  = (ksf.measurement_config as Record<string, unknown>) ?? {};

    // Valor del período anterior para calcular tendencia
    const prevPeriod  = subWeeks(period, 1);
    const prevMeasure = await this.prisma.goalMeasurement.findUnique({
      where: { ksf_id_period: { ksf_id: ksfId, period: prevPeriod } },
      select: { actual_value: true, consecutive_above_satisfactory: true, consecutive_below_minimum: true },
    });

    const result = await this.calculator.calculate(
      ksf.measurement_source,
      config,
      ownerId,
      period,
      ksf.minimum_level,
      ksf.satisfactory_level,
      ksf.outstanding_level,
      prevMeasure?.actual_value,
    );

    // Actualizar contadores consecutivos
    const prevAbove = prevMeasure?.consecutive_above_satisfactory ?? 0;
    const prevBelow = prevMeasure?.consecutive_below_minimum ?? 0;

    const isAbove = result.status === 'SATISFACTORY' || result.status === 'OUTSTANDING';
    const isBelow = result.status === 'BELOW_MINIMUM' || result.status === 'AT_MINIMUM';

    const consecutive_above = isAbove ? prevAbove + 1 : 0;
    const consecutive_below = isBelow ? prevBelow + 1 : 0;

    return this.prisma.goalMeasurement.upsert({
      where: { ksf_id_period: { ksf_id: ksfId, period } },
      create: {
        ksf_id: ksfId,
        team_slot_id: ksf.team_slot_id,
        period,
        actual_value: result.actual_value,
        status: result.status,
        trend: result.trend,
        consecutive_above_satisfactory: consecutive_above,
        consecutive_below_minimum: consecutive_below,
        snapshot: { source: ksf.measurement_source, config } as any,
      },
      update: {
        actual_value: result.actual_value,
        status: result.status,
        trend: result.trend,
        consecutive_above_satisfactory: consecutive_above,
        consecutive_below_minimum: consecutive_below,
      },
    });
  }

  // ─── Medir todos los KSFs del tenant ────────────────────────────────────

  async measureAllKsfs(tenantId: string, period: Date) {
    const ksfs = await this.prisma.keySuccessFactor.findMany({
      where: { tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    for (const ksf of ksfs) {
      await this.measureKsf(ksf.id, period).catch(() => null); // continúa si uno falla
    }
  }

  // ─── Informe de Retroalimentación (semanal por TeamSlot) ─────────────────

  async generateFeedbackReport(slotId: string, weekStart: Date) {
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

    const measurements = await this.prisma.goalMeasurement.findMany({
      where: {
        team_slot_id: slotId,
        period: { gte: weekStart, lte: weekEnd },
      },
      include: { ksf: true },
    });

    const positive_results = measurements
      .filter(m => m.status === 'SATISFACTORY' || m.status === 'OUTSTANDING')
      .map(m => ({
        ksf_id: m.ksf_id,
        name: m.ksf.name,
        actual: m.actual_value,
        satisfactory_level: m.ksf.satisfactory_level,
        outstanding_level: m.ksf.outstanding_level,
        unit: m.ksf.unit,
        consecutive_periods: m.consecutive_above_satisfactory,
      }));

    const negative_results = measurements
      .filter(m => m.status === 'BELOW_MINIMUM' || m.status === 'AT_MINIMUM')
      .map(m => ({
        ksf_id: m.ksf_id,
        name: m.ksf.name,
        actual: m.actual_value,
        minimum_level: m.ksf.minimum_level,
        unit: m.ksf.unit,
        consecutive_periods: m.consecutive_below_minimum,
      }));

    const tenant = await this.prisma.teamSlot.findUniqueOrThrow({
      where: { id: slotId }, select: { tenant_id: true },
    });

    return this.prisma.feedbackReport.upsert({
      where: { team_slot_id_week_start: { team_slot_id: slotId, week_start: weekStart } },
      create: { tenant_id: tenant.tenant_id, team_slot_id: slotId, week_start: weekStart, positive_results, negative_results },
      update: { positive_results, negative_results, generated_at: new Date() },
    });
  }

  // ─── Informe de Administración (semanal por Manager) ─────────────────────

  async generateManagementReport(managerSlotId: string, weekStart: Date) {
    const managerLevel = await this.getOrgLevel(managerSlotId);

    const config = await this.prisma.escalationConfig.findUnique({
      where: { manager_slot_id: managerSlotId },
    }) ?? ESCALATION_DEFAULT;

    // Zonas 2 y 4: reportes directos
    const directReports = await this.prisma.teamSlot.findMany({
      where: { reports_to_id: managerSlotId },
      select: { id: true, name: true, department: { select: { name: true } } },
    });

    const zone2: unknown[] = [];
    const zone4: unknown[] = [];

    for (const slot of directReports) {
      const report = await this.prisma.feedbackReport.findUnique({
        where: { team_slot_id_week_start: { team_slot_id: slot.id, week_start: weekStart } },
      });
      if (!report) continue;

      const deptName = slot.department?.name ?? '';
      for (const r of (report.positive_results as any[])) {
        zone2.push({ ...r, slot_id: slot.id, slot_name: slot.name, dept_name: deptName, levels_below: 1 });
      }
      for (const r of (report.negative_results as any[])) {
        zone4.push({ ...r, slot_id: slot.id, slot_name: slot.name, dept_name: deptName, levels_below: 1 });
      }
    }

    // Zonas 1 y 3: reportes indirectos (aplica reglas de escalación)
    const zone1: unknown[] = [];
    const zone3: unknown[] = [];

    const allBelow = await this.getAllIndirectReports(managerSlotId);

    for (const { slot, levelsBelow } of allBelow) {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const measurements = await this.prisma.goalMeasurement.findMany({
        where: { team_slot_id: slot.id, period: { gte: weekStart, lte: weekEnd } },
        include: { ksf: true },
      });

      for (const m of measurements) {
        const abovePeriods = m.consecutive_above_satisfactory;
        const belowPeriods = m.consecutive_below_minimum;

        const entry = {
          slot_id: slot.id, slot_name: slot.name,
          ksf_id: m.ksf_id, ksf_name: m.ksf.name,
          actual: m.actual_value, unit: m.ksf.unit,
          levels_below: levelsBelow,
          dept_name: slot.department?.name ?? '',
        };

        if (abovePeriods >= config.threshold2_periods && levelsBelow <= config.threshold2_levels) {
          zone1.push({ ...entry, consecutive_periods: abovePeriods, satisfactory_level: m.ksf.satisfactory_level, escalation_tier: 2 });
        } else if (abovePeriods >= config.threshold1_periods && levelsBelow <= config.threshold1_levels) {
          zone1.push({ ...entry, consecutive_periods: abovePeriods, satisfactory_level: m.ksf.satisfactory_level, escalation_tier: 1 });
        }

        if (belowPeriods >= config.threshold2_periods && levelsBelow <= config.threshold2_levels) {
          zone3.push({ ...entry, consecutive_periods: belowPeriods, minimum_level: m.ksf.minimum_level, escalation_tier: 2 });
        } else if (belowPeriods >= config.threshold1_periods && levelsBelow <= config.threshold1_levels) {
          zone3.push({ ...entry, consecutive_periods: belowPeriods, minimum_level: m.ksf.minimum_level, escalation_tier: 1 });
        }
      }
    }

    const tenant = await this.prisma.teamSlot.findUniqueOrThrow({
      where: { id: managerSlotId }, select: { tenant_id: true },
    });

    return this.prisma.managementReport.upsert({
      where: { manager_slot_id_week_start: { manager_slot_id: managerSlotId, week_start: weekStart } },
      create: {
        tenant_id: tenant.tenant_id,
        manager_slot_id: managerSlotId,
        week_start: weekStart,
        zone1_outstanding: zone1 as any,
        zone2_positives: zone2 as any,
        zone3_chronic: zone3 as any,
        zone4_negatives: zone4 as any,
      },
      update: {
        zone1_outstanding: zone1 as any,
        zone2_positives: zone2 as any,
        zone3_chronic: zone3 as any,
        zone4_negatives: zone4 as any,
        generated_at: new Date(),
      },
    });
  }

  // ─── Informe de Enfoque (mensual) ────────────────────────────────────────

  async generateFocusReport(targetLevel: KsfLevel, targetId: string, period: Date) {
    const monthStart = startOfMonth(period);

    const ksfWhere = targetLevel === KsfLevel.COMPANY
      ? { tenant_id: targetId, level: KsfLevel.COMPANY, is_active: true }
      : targetLevel === KsfLevel.DEPARTMENT
        ? { dept_id: targetId, is_active: true }
        : { team_slot_id: targetId, is_active: true };

    const ksfs = await this.prisma.keySuccessFactor.findMany({
      where: ksfWhere,
      include: {
        measurements: {
          orderBy: { period: 'desc' },
          take: 12, // últimas 12 mediciones para tendencia histórica
        },
      },
    });

    const tenant_id = await this.resolveTenantId(targetLevel, targetId);

    const ksf_snapshots = ksfs.map(ksf => {
      const latest = ksf.measurements[0];
      const history = ksf.measurements.map(m => ({
        period: m.period,
        value: m.actual_value,
        status: m.status,
      })).reverse();

      return {
        ksf_id: ksf.id,
        name: ksf.name,
        unit: ksf.unit,
        category: ksf.category,
        actual: latest?.actual_value ?? null,
        minimum: ksf.minimum_level,
        satisfactory: ksf.satisfactory_level,
        outstanding: ksf.outstanding_level,
        status: latest?.status ?? KsfStatus.NO_DATA,
        trend: latest?.trend ?? 'STABLE',
        history,
      };
    });

    return this.prisma.focusReport.upsert({
      where: { target_id_period: { target_id: targetId, period: monthStart } },
      create: {
        tenant_id,
        target_level: targetLevel,
        target_id: targetId,
        team_slot_id: targetLevel === KsfLevel.EMPLOYEE ? targetId : undefined,
        period: monthStart,
        ksf_snapshots,
      },
      update: { ksf_snapshots, generated_at: new Date() },
    });
  }

  // ─── Generar todos los informes semanales del tenant ─────────────────────

  async generateAllWeeklyReports(tenantId: string, weekStart: Date) {
    const slots = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId },
      select: { id: true, reports_to_id: true },
    });

    // Feedback para cada slot
    for (const slot of slots) {
      await this.generateFeedbackReport(slot.id, weekStart).catch(() => null);
    }

    // Management para cada manager (slots que tienen reportes directos)
    const managers = slots.filter(s => slots.some(r => r.reports_to_id === s.id));
    for (const manager of managers) {
      await this.generateManagementReport(manager.id, weekStart).catch(() => null);
    }
  }

  // ─── Generar todos los informes mensuales del tenant ─────────────────────

  async generateAllMonthlyReports(tenantId: string, period: Date) {
    const slots = await this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId }, select: { id: true },
    });
    const depts = await this.prisma.department.findMany({
      where: { tenant_id: tenantId }, select: { id: true },
    });

    await this.generateFocusReport(KsfLevel.COMPANY, tenantId, period).catch(() => null);

    for (const dept of depts) {
      await this.generateFocusReport(KsfLevel.DEPARTMENT, dept.id, period).catch(() => null);
    }
    for (const slot of slots) {
      await this.generateFocusReport(KsfLevel.EMPLOYEE, slot.id, period).catch(() => null);
    }
  }

  // ─── Helpers privados ────────────────────────────────────────────────────

  private async getOrgLevel(slotId: string): Promise<number> {
    let level = 0;
    let currentId: string | null = slotId;
    while (currentId) {
      const slot = await this.prisma.teamSlot.findUnique({
        where: { id: currentId }, select: { reports_to_id: true },
      });
      if (!slot?.reports_to_id) break;
      currentId = slot.reports_to_id;
      level++;
      if (level > 10) break;
    }
    return level;
  }

  private async getAllIndirectReports(
    managerSlotId: string,
    maxDepth = 5,
  ): Promise<{ slot: any; levelsBelow: number }[]> {
    const result: { slot: any; levelsBelow: number }[] = [];
    const directIds = new Set(
      (await this.prisma.teamSlot.findMany({ where: { reports_to_id: managerSlotId }, select: { id: true } }))
        .map(s => s.id),
    );

    const queue: { id: string; depth: number }[] = [...directIds].map(id => ({ id, depth: 1 }));

    while (queue.length) {
      const { id, depth } = queue.shift()!;
      if (depth > maxDepth) continue;

      const children = await this.prisma.teamSlot.findMany({
        where: { reports_to_id: id },
        select: { id: true, name: true, department: { select: { name: true } } },
      });

      for (const child of children) {
        result.push({ slot: child, levelsBelow: depth + 1 });
        queue.push({ id: child.id, depth: depth + 1 });
      }
    }

    return result;
  }

  private async resolveTenantId(level: KsfLevel, targetId: string): Promise<string> {
    if (level === KsfLevel.COMPANY) return targetId;
    if (level === KsfLevel.DEPARTMENT) {
      const dept = await this.prisma.department.findUniqueOrThrow({ where: { id: targetId }, select: { tenant_id: true } });
      return dept.tenant_id;
    }
    const slot = await this.prisma.teamSlot.findUniqueOrThrow({ where: { id: targetId }, select: { tenant_id: true } });
    return slot.tenant_id;
  }
}
