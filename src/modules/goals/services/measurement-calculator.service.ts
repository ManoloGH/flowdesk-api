import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { MeasurementSource, KsfStatus, Trend } from '@prisma/client';
import { startOfWeek, endOfWeek, startOfDay, endOfDay, subWeeks } from 'date-fns';

export interface MeasurementResult {
  actual_value: number;
  status: KsfStatus;
  trend: Trend;
}

@Injectable()
export class MeasurementCalculatorService {
  constructor(private prisma: PrismaService) {}

  async calculate(
    source: MeasurementSource,
    config: Record<string, unknown>,
    ownerId: string,          // team_slot_id | dept_id | tenant_id
    period: Date,             // inicio del período
    minimumLevel: number,
    satisfactoryLevel: number,
    outstandingLevel: number,
    previousValue?: number,
  ): Promise<MeasurementResult> {
    const actualValue = await this.fetchValue(source, config, ownerId, period);
    const status = this.computeStatus(actualValue, minimumLevel, satisfactoryLevel, outstandingLevel);
    const trend = previousValue !== undefined ? this.computeTrend(actualValue, previousValue) : Trend.STABLE;
    return { actual_value: actualValue, status, trend };
  }

  // ─── Dispatcher por fuente ────────────────────────────────────────────────

  private async fetchValue(
    source: MeasurementSource,
    config: Record<string, unknown>,
    ownerId: string,
    period: Date,
  ): Promise<number> {
    const weekStart = startOfWeek(period, { weekStartsOn: 1 });
    const weekEnd   = endOfWeek(period,   { weekStartsOn: 1 });
    const dayStart  = startOfDay(period);
    const dayEnd    = endOfDay(period);

    switch (source) {

      // ── OPERATIONAL ──────────────────────────────────────────────────────

      case MeasurementSource.TASKS_COMPLETION_RATE: {
        const [total, completed] = await Promise.all([
          this.prisma.task.count({ where: { assignee_id: ownerId, created_at: { gte: weekStart, lte: weekEnd } } }),
          this.prisma.task.count({ where: { assignee_id: ownerId, status: 'completed', completed_at: { gte: weekStart, lte: weekEnd } } }),
        ]);
        return total > 0 ? Math.round((completed / total) * 100) : 0;
      }

      case MeasurementSource.TASKS_ON_TIME_RATE: {
        const completed = await this.prisma.task.findMany({
          where: { assignee_id: ownerId, status: 'completed', completed_at: { gte: weekStart, lte: weekEnd } },
          select: { due_date: true, completed_at: true },
        });
        if (!completed.length) return 0;
        const onTime = completed.filter(t => !t.due_date || (t.completed_at && t.completed_at <= t.due_date));
        return Math.round((onTime.length / completed.length) * 100);
      }

      case MeasurementSource.TASKS_COMPLETED_COUNT: {
        return this.prisma.task.count({
          where: { assignee_id: ownerId, status: 'completed', completed_at: { gte: weekStart, lte: weekEnd } },
        });
      }

      case MeasurementSource.MESSAGE_RESPONSE_TIME_AVG: {
        // Mensajes recibidos con reply en el período — calcula tiempo promedio en minutos
        const messages = await this.prisma.message.findMany({
          where: { receiver_id: ownerId, read_at: { gte: weekStart, lte: weekEnd } },
          select: { created_at: true, read_at: true },
        });
        if (!messages.length) return 0;
        const avgMs = messages.reduce((sum, m) => {
          const diff = m.read_at ? m.read_at.getTime() - m.created_at.getTime() : 0;
          return sum + diff;
        }, 0) / messages.length;
        return Math.round(avgMs / 60_000); // ms → minutos
      }

      case MeasurementSource.MESSAGE_VOLUME: {
        return this.prisma.message.count({
          where: { sender_id: ownerId, created_at: { gte: weekStart, lte: weekEnd } },
        });
      }

      case MeasurementSource.PRESENCE_HOURS: {
        const logs = await this.prisma.timeLog.findMany({
          where: { slot_id: ownerId, check_in: { gte: dayStart, lte: dayEnd } },
          select: { check_in: true, check_out: true },
        });
        const totalMs = logs.reduce((sum, l) => {
          const end = l.check_out ?? new Date();
          return sum + (end.getTime() - l.check_in.getTime());
        }, 0);
        return Math.round(totalMs / 3_600_000 * 10) / 10; // ms → horas (1 decimal)
      }

      case MeasurementSource.PRESENCE_ATTENDANCE_RATE: {
        const [scheduled, present] = await Promise.all([
          // días programados en el período — usa el schedule del slot
          this.countScheduledDays(ownerId, weekStart, weekEnd),
          this.prisma.timeLog.count({ where: { slot_id: ownerId, check_in: { gte: weekStart, lte: weekEnd } } }),
        ]);
        return scheduled > 0 ? Math.round((present / scheduled) * 100) : 0;
      }

      case MeasurementSource.PRESENCE_PUNCTUALITY_RATE: {
        const logs = await this.prisma.timeLog.findMany({
          where: { slot_id: ownerId, check_in: { gte: weekStart, lte: weekEnd } },
          select: { status: true },
        });
        if (!logs.length) return 0;
        const onTime = logs.filter(l => l.status === 'on_time').length;
        return Math.round((onTime / logs.length) * 100);
      }

      case MeasurementSource.AGENT_RESOLUTION_RATE: {
        const [total, resolved] = await Promise.all([
          this.prisma.agentConversation.count({ where: { agent_id: ownerId, started_at: { gte: weekStart, lte: weekEnd } } }),
          this.prisma.agentConversation.count({
            where: {
              agent_id: ownerId,
              started_at: { gte: weekStart, lte: weekEnd },
              ended_at: { not: null },
            },
          }),
        ]);
        return total > 0 ? Math.round((resolved / total) * 100) : 0;
      }

      case MeasurementSource.AGENT_CONVERSATION_COUNT: {
        return this.prisma.agentConversation.count({
          where: { agent_id: ownerId, started_at: { gte: weekStart, lte: weekEnd } },
        });
      }

      case MeasurementSource.CRM_CONTACTS_MANAGED: {
        return this.prisma.contact.count({
          where: { owner_slot_id: ownerId, last_contact_at: { gte: weekStart, lte: weekEnd } },
        });
      }

      case MeasurementSource.CRM_DEALS_CLOSED: {
        return this.prisma.deal.count({
          where: { owner_id: ownerId, status: 'won', closed_at: { gte: weekStart, lte: weekEnd } },
        });
      }

      case MeasurementSource.CRM_DEALS_VALUE: {
        const result = await this.prisma.deal.aggregate({
          where: { owner_id: ownerId, status: 'won', closed_at: { gte: weekStart, lte: weekEnd } },
          _sum: { value: true },
        });
        return result._sum.value ?? 0;
      }

      // ── COORDINATION ─────────────────────────────────────────────────────

      case MeasurementSource.TEAM_TASK_COMPLETION_RATE: {
        const directReports = await this.getDirectReportIds(ownerId);
        if (!directReports.length) return 0;
        const [total, completed] = await Promise.all([
          this.prisma.task.count({ where: { assignee_id: { in: directReports }, created_at: { gte: weekStart, lte: weekEnd } } }),
          this.prisma.task.count({ where: { assignee_id: { in: directReports }, status: 'completed', completed_at: { gte: weekStart, lte: weekEnd } } }),
        ]);
        return total > 0 ? Math.round((completed / total) * 100) : 0;
      }

      case MeasurementSource.TEAM_RESPONSE_TIME_AVG: {
        const directReports = await this.getDirectReportIds(ownerId);
        if (!directReports.length) return 0;
        const messages = await this.prisma.message.findMany({
          where: { receiver_id: { in: directReports }, read_at: { gte: weekStart, lte: weekEnd } },
          select: { created_at: true, read_at: true },
        });
        if (!messages.length) return 0;
        const avgMs = messages.reduce((sum, m) => {
          return sum + (m.read_at ? m.read_at.getTime() - m.created_at.getTime() : 0);
        }, 0) / messages.length;
        return Math.round(avgMs / 60_000);
      }

      case MeasurementSource.TEAM_PRESENCE_RATE: {
        const directReports = await this.getDirectReportIds(ownerId);
        if (!directReports.length) return 0;
        const rates: number[] = [];
        for (const slotId of directReports) {
          const scheduled = await this.countScheduledDays(slotId, weekStart, weekEnd);
          const present   = await this.prisma.timeLog.count({ where: { slot_id: slotId, check_in: { gte: weekStart, lte: weekEnd } } });
          if (scheduled > 0) rates.push(present / scheduled);
        }
        return rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) : 0;
      }

      case MeasurementSource.DEPT_KPIS_IN_GREEN: {
        // % de KSFs del dept/team en SATISFACTORY o OUTSTANDING esta semana
        const recentMeasurements = await this.prisma.goalMeasurement.findMany({
          where: {
            period: { gte: weekStart, lte: weekEnd },
            ksf: { dept_id: ownerId, is_active: true },
          },
          select: { status: true },
        });
        if (!recentMeasurements.length) return 0;
        const green = recentMeasurements.filter(m =>
          m.status === 'SATISFACTORY' || m.status === 'OUTSTANDING',
        ).length;
        return Math.round((green / recentMeasurements.length) * 100);
      }

      case MeasurementSource.PIPELINE_CONVERSION_RATE: {
        const deptId = config.dept_id as string | undefined;
        const [total, won] = await Promise.all([
          this.prisma.deal.count({ where: { ...(deptId ? { pipeline: { department_id: deptId } } : {}), created_at: { gte: weekStart, lte: weekEnd } } }),
          this.prisma.deal.count({ where: { ...(deptId ? { pipeline: { department_id: deptId } } : {}), status: 'won', closed_at: { gte: weekStart, lte: weekEnd } } }),
        ]);
        return total > 0 ? Math.round((won / total) * 100) : 0;
      }

      case MeasurementSource.PIPELINE_TOTAL_VALUE: {
        const result = await this.prisma.deal.aggregate({
          where: { status: 'open', pipeline: { department_id: ownerId } },
          _sum: { value: true },
        });
        return result._sum.value ?? 0;
      }

      // ── STRATEGIC ────────────────────────────────────────────────────────

      case MeasurementSource.PROJECT_MILESTONE_PCT: {
        const ksfId = config.ksf_id as string;
        const [total, completed] = await Promise.all([
          this.prisma.ksfMilestone.count({ where: { ksf_id: ksfId } }),
          this.prisma.ksfMilestone.count({ where: { ksf_id: ksfId, completed_at: { not: null } } }),
        ]);
        return total > 0 ? Math.round((completed / total) * 100) : 0;
      }

      case MeasurementSource.MANUAL:
        return (config.manual_value as number) ?? 0;

      default:
        return 0;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private computeStatus(
    actual: number, min: number, satisfactory: number, outstanding: number,
  ): KsfStatus {
    if (actual >= outstanding)   return KsfStatus.OUTSTANDING;
    if (actual >= satisfactory)  return KsfStatus.SATISFACTORY;
    if (actual > min)            return KsfStatus.IN_PROGRESS;
    if (actual === min)          return KsfStatus.AT_MINIMUM;
    return KsfStatus.BELOW_MINIMUM;
  }

  private computeTrend(current: number, previous: number): Trend {
    const delta = current - previous;
    const threshold = Math.abs(previous) * 0.03; // 3% de cambio para considerar movimiento
    if (delta > threshold)  return Trend.UP;
    if (delta < -threshold) return Trend.DOWN;
    return Trend.STABLE;
  }

  private async getDirectReportIds(managerSlotId: string): Promise<string[]> {
    const reports = await this.prisma.teamSlot.findMany({
      where: { reports_to_id: managerSlotId },
      select: { id: true },
    });
    return reports.map(r => r.id);
  }

  private async countScheduledDays(slotId: string, from: Date, to: Date): Promise<number> {
    const slot = await this.prisma.teamSlot.findUnique({
      where: { id: slotId },
      include: { schedule: true },
    });
    if (!slot?.schedule) return 5; // default 5 días hábiles si no hay schedule

    const workDays: string[] = (slot.schedule.work_days as string[]) ?? ['MON','TUE','WED','THU','FRI'];
    const dayMap: Record<number, string> = { 0:'SUN',1:'MON',2:'TUE',3:'WED',4:'THU',5:'FRI',6:'SAT' };

    let count = 0;
    const current = new Date(from);
    while (current <= to) {
      if (workDays.includes(dayMap[current.getDay()])) count++;
      current.setDate(current.getDate() + 1);
    }
    return count;
  }
}
