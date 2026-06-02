import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export class CreateDealDto {
  contact_id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value?: number;
  currency?: string;
  expected_close?: string;
  notes?: string;
}

export class MoveDealDto {
  stage_id: string;
  notes?: string;
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async getPipelines(tenantId: string) {
    return this.prisma.pipeline.findMany({
      where: { tenant_id: tenantId, is_active: true },
      include: {
        stages: { orderBy: { order_index: 'asc' } },
        _count: { select: { deals: true } },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async getPipelineWithDeals(tenantId: string, pipelineId: string) {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: pipelineId, tenant_id: tenantId },
      include: { stages: { orderBy: { order_index: 'asc' } } },
    });
    if (!pipeline) throw new NotFoundException('Pipeline no encontrado');

    const deals = await this.prisma.deal.findMany({
      where: { tenant_id: tenantId, pipeline_id: pipelineId },
      include: {
        contact: { select: { first_name: true, last_name: true, phone: true, email: true } },
        stage: { select: { name: true, color: true } },
        owner: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    const byStage = pipeline.stages.map(stage => ({
      ...stage,
      deals: deals.filter(d => d.stage_id === stage.id),
    }));

    return { pipeline, stages: byStage };
  }

  async createDeal(tenantId: string, ownerId: string, dto: CreateDealDto) {
    return this.prisma.deal.create({
      data: {
        tenant_id:      tenantId,
        pipeline_id:    dto.pipeline_id,
        stage_id:       dto.stage_id,
        contact_id:     dto.contact_id,
        owner_id:       ownerId,
        title:          dto.title,
        value:          dto.value,
        currency:       dto.currency ?? 'MXN',
        expected_close: dto.expected_close ? new Date(dto.expected_close) : null,
        notes:          dto.notes,
        status:         'open',
      },
      include: {
        contact: { select: { first_name: true, last_name: true } },
        stage: { select: { name: true } },
      },
    });
  }

  async moveDeal(tenantId: string, dealId: string, dto: MoveDealDto) {
    const deal = await this.prisma.deal.findFirst({ where: { id: dealId, tenant_id: tenantId } });
    if (!deal) throw new NotFoundException('Deal no encontrado');

    return this.prisma.deal.update({
      where: { id: dealId },
      data: { stage_id: dto.stage_id, notes: dto.notes ?? deal.notes },
    });
  }

  async closeDeal(tenantId: string, dealId: string, won: boolean, notes?: string) {
    const deal = await this.prisma.deal.findFirst({ where: { id: dealId, tenant_id: tenantId } });
    if (!deal) throw new NotFoundException('Deal no encontrado');

    return this.prisma.deal.update({
      where: { id: dealId },
      data: {
        status:    won ? 'won' : 'lost',
        closed_at: new Date(),
        notes:     notes ?? deal.notes,
      },
    });
  }

  async getStaledDeals(tenantId: string, daysSinceUpdate = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSinceUpdate);

    return this.prisma.deal.findMany({
      where: {
        tenant_id:  tenantId,
        status:     'open',
        updated_at: { lt: cutoff },
      },
      include: {
        contact: { select: { first_name: true, last_name: true, phone: true } },
        stage:   { select: { name: true } },
      },
      orderBy: { updated_at: 'asc' },
    });
  }

  async getSummary(tenantId: string) {
    const [open, won, lost, staled] = await Promise.all([
      this.prisma.deal.count({ where: { tenant_id: tenantId, status: 'open' } }),
      this.prisma.deal.count({ where: { tenant_id: tenantId, status: 'won' } }),
      this.prisma.deal.count({ where: { tenant_id: tenantId, status: 'lost' } }),
      this.getStaledDeals(tenantId),
    ]);

    const openValue = await this.prisma.deal.aggregate({
      where: { tenant_id: tenantId, status: 'open' },
      _sum: { value: true },
    });
    const wonValue = await this.prisma.deal.aggregate({
      where: { tenant_id: tenantId, status: 'won' },
      _sum: { value: true },
    });

    return {
      open,
      won,
      lost,
      staled: staled.length,
      pipeline_value: openValue._sum.value ?? 0,
      won_value:      wonValue._sum.value ?? 0,
    };
  }
}
