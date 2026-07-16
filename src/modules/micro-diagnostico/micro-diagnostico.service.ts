import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class MicroDiagnosticoService {
  constructor(private readonly prisma: PrismaService) {}

  async findByToken(token: string) {
    const record = await this.prisma.microDiagnostico.findUnique({
      where: { token },
      select: {
        id: true,
        token: true,
        lead_name: true,
        lead_company: true,
        responses: true,
        diagnostic_data: true,
        cal_booking_url: true,
        created_at: true,
      },
    });
    if (!record) throw new NotFoundException('Micro-diagnóstico no encontrado');
    return record;
  }

  async listByTenant(tenantId: string) {
    return this.prisma.microDiagnostico.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        token: true,
        lead_name: true,
        lead_company: true,
        lead_phone: true,
        contact_id: true,
        deal_id: true,
        created_at: true,
      },
    });
  }
}
