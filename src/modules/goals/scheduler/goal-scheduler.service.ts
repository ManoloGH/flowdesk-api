import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../database/prisma.service';
import { ReportGeneratorService } from '../services/report-generator.service';
import { startOfWeek, startOfMonth, subDays } from 'date-fns';

@Injectable()
export class GoalSchedulerService {
  private readonly logger = new Logger(GoalSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private reportGenerator: ReportGeneratorService,
  ) {}

  // ─── Snapshot diario (EOD — 23:00) ───────────────────────────────────────
  // Calcula KSFs de frecuencia DAILY para todos los tenants.

  @Cron('0 23 * * *', { name: 'daily-ksf-snapshot' })
  async dailySnapshot() {
    this.logger.log('Iniciando snapshot diario de KSFs...');
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    const today = new Date();

    for (const tenant of tenants) {
      await this.reportGenerator.measureAllKsfs(tenant.id, today).catch(err =>
        this.logger.error(`Error midiendo KSFs (tenant ${tenant.id}): ${err.message}`),
      );
    }
    this.logger.log(`Snapshot diario completado — ${tenants.length} tenants`);
  }

  // ─── Informes semanales (lunes 7:00am) ───────────────────────────────────
  // 1. Mide KSFs semanales
  // 2. Genera FeedbackReport para cada TeamSlot
  // 3. Genera ManagementReport para cada manager

  @Cron('0 7 * * 1', { name: 'weekly-reports' })
  async weeklyReports() {
    this.logger.log('Generando informes semanales AUP...');
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });

    // La semana pasada (el reporte es de la semana anterior)
    const lastWeekStart = startOfWeek(subDays(new Date(), 7), { weekStartsOn: 1 });

    for (const tenant of tenants) {
      try {
        // 1. Medir KSFs semanales
        await this.reportGenerator.measureAllKsfs(tenant.id, lastWeekStart);
        // 2. Generar Feedback + Management reports
        await this.reportGenerator.generateAllWeeklyReports(tenant.id, lastWeekStart);
        this.logger.log(`Informes semanales generados — tenant ${tenant.id}`);
      } catch (err) {
        this.logger.error(`Error en informes semanales (tenant ${tenant.id}): ${err.message}`);
      }
    }
  }

  // ─── Informes mensuales (día 1 de cada mes, 8:00am) ─────────────────────
  // Genera FocusReport para cada persona, departamento y empresa.

  @Cron('0 8 1 * *', { name: 'monthly-focus-reports' })
  async monthlyFocusReports() {
    this.logger.log('Generando Informes de Enfoque mensuales...');
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    const period = startOfMonth(new Date());

    for (const tenant of tenants) {
      await this.reportGenerator.generateAllMonthlyReports(tenant.id, period).catch(err =>
        this.logger.error(`Error en Informe de Enfoque (tenant ${tenant.id}): ${err.message}`),
      );
    }
    this.logger.log(`Informes de Enfoque generados — ${tenants.length} tenants`);
  }
}
