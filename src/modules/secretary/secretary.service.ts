import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export class UpsertSecretaryConfigDto {
  owner_phone: string;
  evolution_instance?: string;
  morning_brief_time?: string;
  morning_brief_enabled?: boolean;
  enabled?: boolean;
}

@Injectable()
export class SecretaryService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Config ────────────────────────────────────────────────────────────────

  async getConfig(tenantId: string) {
    return this.prisma.secretaryConfig.findUnique({ where: { tenant_id: tenantId } });
  }

  async upsertConfig(tenantId: string, dto: UpsertSecretaryConfigDto) {
    return this.prisma.secretaryConfig.upsert({
      where: { tenant_id: tenantId },
      create: { tenant_id: tenantId, ...dto },
      update: { ...dto, updated_at: new Date() },
    });
  }

  async findTenantByPhone(phone: string): Promise<string | null> {
    const normalized = phone.replace(/\D/g, '');
    const config = await this.prisma.secretaryConfig.findFirst({
      where: { owner_phone: normalized, enabled: true },
    });
    return config?.tenant_id ?? null;
  }

  async getEvolutionInstance(tenantId: string): Promise<string | null> {
    const config = await this.prisma.secretaryConfig.findUnique({
      where: { tenant_id: tenantId },
      select: { evolution_instance: true, enabled: true },
    });
    if (!config?.enabled) return null;
    return config.evolution_instance ?? process.env.EVOLUTION_INSTANCE ?? null;
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  async createApproval(tenantId: string, requestedBy: string, description: string, context: Record<string, unknown> = {}) {
    return this.prisma.pendingApproval.create({
      data: { tenant_id: tenantId, requested_by: requestedBy, description, context: context as any },
    });
  }

  async getPendingApprovals(tenantId: string) {
    return this.prisma.pendingApproval.findMany({
      where: { tenant_id: tenantId, status: 'pending' },
      orderBy: { created_at: 'asc' },
    });
  }

  async decide(tenantId: string, approvalId: string, decision: 'approved' | 'rejected', decidedBy: string) {
    const approval = await this.prisma.pendingApproval.findFirst({
      where: { id: approvalId, tenant_id: tenantId },
    });
    if (!approval) throw new NotFoundException('Aprobación no encontrada');
    return this.prisma.pendingApproval.update({
      where: { id: approvalId },
      data: { status: decision, decided_by: decidedBy, decided_at: new Date() },
    });
  }

  // ── Delegation ────────────────────────────────────────────────────────────

  async logDelegation(tenantId: string, fromSlot: string, toSlot: string, task: string, result?: string) {
    return this.prisma.delegationHistory.create({
      data: { tenant_id: tenantId, from_slot: fromSlot, to_slot: toSlot, task, result },
    });
  }

  async getDelegationHistory(tenantId: string, limit = 20) {
    return this.prisma.delegationHistory.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  // ── Work Reports ──────────────────────────────────────────────────────────

  async saveWorkReport(tenantId: string, slotId: string, period: 'daily' | 'weekly', content: Record<string, unknown>) {
    return this.prisma.workReport.create({
      data: { tenant_id: tenantId, slot_id: slotId, period, content: content as any },
    });
  }

  async getWorkReports(tenantId: string, period?: 'daily' | 'weekly', limit = 10) {
    return this.prisma.workReport.findMany({
      where: { tenant_id: tenantId, ...(period ? { period } : {}) },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }
}
