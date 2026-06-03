import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { TenantsService } from './tenants.service';

@Injectable()
export class FocusBriefScheduler {
  private readonly logger = new Logger(FocusBriefScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
  ) {}

  // Lunes a viernes a las 7:30 AM (hora servidor — Railway usa UTC, ajustar si es necesario)
  @Cron('30 7 * * 1-5')
  async pregenerateBriefs() {
    this.logger.log('Iniciando pre-generación de Focus Briefs...');

    const activeTenants = await this.prisma.tenant.findMany({
      where: { status: 'active', tenant_type: { not: 'PLATFORM' } },
      select: { id: true, name: true },
    });

    let ok = 0;
    let fail = 0;

    for (const tenant of activeTenants) {
      try {
        const owner = await this.prisma.teamSlot.findFirst({
          where: { tenant_id: tenant.id, role: 'owner', type: 'HUMAN' },
          select: { id: true },
        });
        if (!owner) continue;

        await this.tenants.getFocusBriefCached(tenant.id, owner.id, true);
        ok++;
      } catch (err) {
        this.logger.warn(`Brief failed for ${tenant.name}: ${(err as Error).message}`);
        fail++;
      }

      // Pausa entre tenants para no saturar la API de Anthropic
      await new Promise(r => setTimeout(r, 2000));
    }

    this.logger.log(`Focus Briefs pre-generados: ${ok} ok, ${fail} fallidos`);
  }
}
