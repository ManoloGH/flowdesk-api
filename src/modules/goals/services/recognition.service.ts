import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { SendRecognitionDto } from '../dto/goals.dto';

@Injectable()
export class RecognitionService {
  constructor(private prisma: PrismaService) {}

  // Entradas de Zona 1 que aún no tienen reconocimiento enviado
  async getPendingRecognitions(tenantId: string) {
    const latestReport = await this.prisma.managementReport.findFirst({
      where: { tenant_id: tenantId },
      orderBy: { week_start: 'desc' },
    });
    if (!latestReport) return [];

    const zone1 = (latestReport.zone1_outstanding as any[]) ?? [];
    if (!zone1.length) return [];

    // Filtrar las que ya fueron reconocidas esta semana
    const recognized = await this.prisma.recognitionEvent.findMany({
      where: { tenant_id: tenantId, week_start: latestReport.week_start, sent_at: { not: null } },
      select: { recognized_id: true, ksf_id: true },
    });
    const recognizedSet = new Set(recognized.map(r => `${r.recognized_id}:${r.ksf_id}`));

    return zone1.filter((e: any) => !recognizedSet.has(`${e.slot_id}:${e.ksf_id}`));
  }

  async sendRecognition(
    tenantId: string,
    recognizerId: string,
    weekStart: Date,
    dto: SendRecognitionDto,
  ) {
    const zone1Entry = await this.findZone1Entry(tenantId, weekStart, dto.recognized_id, dto.ksf_id);

    return this.prisma.recognitionEvent.create({
      data: {
        tenant_id: tenantId,
        recognizer_id: recognizerId,
        recognized_id: dto.recognized_id,
        ksf_id: dto.ksf_id,
        ksf_name: zone1Entry?.ksf_name ?? '',
        consecutive_periods: zone1Entry?.consecutive_periods ?? 0,
        week_start: weekStart,
        message: dto.message,
        channel: dto.channel,
        sent_at: new Date(),
      },
    });
  }

  async getRecognitionHistory(tenantId: string, slotId?: string) {
    return this.prisma.recognitionEvent.findMany({
      where: {
        tenant_id: tenantId,
        ...(slotId ? { recognized_id: slotId } : {}),
        sent_at: { not: null },
      },
      orderBy: { sent_at: 'desc' },
      take: 50,
    });
  }

  private async findZone1Entry(tenantId: string, weekStart: Date, slotId: string, ksfId: string) {
    const report = await this.prisma.managementReport.findFirst({
      where: { tenant_id: tenantId, week_start: weekStart },
      select: { zone1_outstanding: true },
    });
    const zone1 = (report?.zone1_outstanding as any[]) ?? [];
    return zone1.find((e: any) => e.slot_id === slotId && e.ksf_id === ksfId);
  }
}
