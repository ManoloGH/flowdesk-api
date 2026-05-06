import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class PlatformService {
  constructor(private prisma: PrismaService) {}

  // ─── Verificar nivel de acceso ──────────────────────────────────────────────

  async assertPlatform(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { tenant_type: true } });
    if (tenant?.tenant_type !== 'PLATFORM') throw new ForbiddenException('Acceso restringido a la plataforma.');
    return tenant;
  }

  async assertNetworkOrAbove(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { tenant_type: true } });
    if (!tenant || (tenant.tenant_type !== 'PLATFORM' && tenant.tenant_type !== 'NETWORK')) {
      throw new ForbiddenException('Acceso restringido a administradores de red.');
    }
    return tenant;
  }

  // ─── PLATFORM: vista global de toda la red ──────────────────────────────────

  async getNetwork(callerTenantId: string) {
    await this.assertPlatform(callerTenantId);

    const tenants = await this.prisma.tenant.findMany({
      where: { tenant_type: { in: ['NETWORK', 'BRANCH'] } },
      select: {
        id: true, name: true, slug: true, tenant_type: true, status: true,
        network_id: true, external_ref: true, employee_desks_enabled: true,
        plan: true, created_at: true,
        _count: { select: { team_slots: true } },
      },
      orderBy: [{ tenant_type: 'asc' }, { name: 'asc' }],
    });

    // Agregar health score por tenant
    const withHealth = await Promise.all(tenants.map(t => this.computeHealth(t)));
    return withHealth;
  }

  async getTenantDetail(callerTenantId: string, targetTenantId: string) {
    await this.assertPlatform(callerTenantId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: targetTenantId },
      include: {
        branches: { select: { id: true, name: true, status: true, external_ref: true } },
        network: { select: { id: true, name: true } },
        _count: { select: { team_slots: true, tasks: true, agent_conversations: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const health = await this.computeHealth(tenant);
    return { ...tenant, health };
  }

  // ─── PLATFORM: provisionar nuevo tenant ────────────────────────────────────

  async provisionTenant(callerTenantId: string, dto: {
    name: string;
    slug: string;
    tenant_type: 'NETWORK' | 'BRANCH';
    network_id?: string;
    external_ref?: string;
    airtable_project_id?: string;
    employee_desks_enabled?: boolean;
    plan?: string;
    owner_email: string;
    owner_name: string;
  }) {
    await this.assertPlatform(callerTenantId);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          tenant_type: dto.tenant_type,
          network_id: dto.network_id ?? null,
          external_ref: dto.external_ref ?? null,
          airtable_project_id: dto.airtable_project_id ?? null,
          employee_desks_enabled: dto.employee_desks_enabled ?? true,
          plan: dto.plan ?? 'starter',
          status: 'active',
        },
      });

      // Crear TeamSlot owner
      const ownerSlot = await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id,
          name: dto.owner_name,
          email: dto.owner_email,
          type: 'HUMAN',
          role: 'owner',
          status: 'OFFLINE',
          desk_access: 'FULL',
        },
      });

      // Crear CEO Agent para el owner
      await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id,
          name: 'Atlas',
          type: 'AI_AGENT',
          role: 'employee',
          status: 'ONLINE',
          agent_role: 'ceo',
          agent_scope: 'personal',
          owner_slot_id: ownerSlot.id,
          agent_config: {
            model: 'claude-sonnet-4-6',
            instructions: `Soy Atlas, CEO Agent personal de ${dto.owner_name} en ${dto.name}. Coordino tareas, agentes y objetivos para maximizar la productividad del equipo.`,
            tools: [],
          },
        },
      });

      return { tenant, owner_slot_id: ownerSlot.id };
    });
  }

  // ─── NETWORK: gestión de sucursales propias ─────────────────────────────────

  async getMyBranches(callerTenantId: string) {
    await this.assertNetworkOrAbove(callerTenantId);

    const caller = await this.prisma.tenant.findUnique({
      where: { id: callerTenantId },
      select: { tenant_type: true },
    });

    const where = caller?.tenant_type === 'PLATFORM'
      ? { tenant_type: 'BRANCH' as const }
      : { network_id: callerTenantId };

    const branches = await this.prisma.tenant.findMany({
      where,
      select: {
        id: true, name: true, slug: true, status: true, external_ref: true,
        employee_desks_enabled: true, created_at: true,
        _count: { select: { team_slots: true } },
      },
      orderBy: { name: 'asc' },
    });

    return Promise.all(branches.map(b => this.computeHealth(b)));
  }

  async provisionBranch(callerTenantId: string, dto: {
    name: string;
    slug: string;
    external_ref?: string;
    employee_desks_enabled?: boolean;
    owner_email: string;
    owner_name: string;
  }) {
    await this.assertNetworkOrAbove(callerTenantId);

    const caller = await this.prisma.tenant.findUnique({
      where: { id: callerTenantId },
      select: { tenant_type: true, plan: true },
    });

    const networkId = caller?.tenant_type === 'NETWORK' ? callerTenantId : undefined;

    // Crear branch directamente (sin pasar por assertPlatform)
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          tenant_type: 'BRANCH',
          network_id: networkId ?? null,
          external_ref: dto.external_ref ?? null,
          employee_desks_enabled: dto.employee_desks_enabled ?? true,
          plan: caller?.plan ?? 'starter',
          status: 'active',
        },
      });

      const ownerSlot = await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id,
          name: dto.owner_name,
          email: dto.owner_email,
          type: 'HUMAN',
          role: 'owner',
          status: 'OFFLINE',
          desk_access: 'FULL',
        },
      });

      await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id,
          name: 'Atlas',
          type: 'AI_AGENT',
          role: 'employee',
          status: 'ONLINE',
          agent_role: 'ceo',
          agent_scope: 'personal',
          owner_slot_id: ownerSlot.id,
          agent_config: {
            model: 'claude-sonnet-4-6',
            instructions: `Soy Atlas, CEO Agent personal de ${dto.owner_name} en ${dto.name}.`,
            tools: [],
          },
        },
      });

      return { tenant, owner_slot_id: ownerSlot.id };
    });
  }

  // ─── EMPLEADOS: gestión de acceso ──────────────────────────────────────────

  async setEmployeeAccess(callerTenantId: string, slotId: string, access: 'FULL' | 'LIGHT' | 'NONE') {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: slotId, tenant_id: callerTenantId, type: 'HUMAN' },
    });
    if (!slot) throw new NotFoundException('Empleado no encontrado');

    const data: any = { desk_access: access };
    if (access === 'LIGHT' && !slot.access_token) {
      data.access_token = randomBytes(16).toString('hex');
    }
    if (access !== 'LIGHT') {
      data.access_token = null;
    }

    return this.prisma.teamSlot.update({
      where: { id: slotId },
      data,
      select: { id: true, name: true, desk_access: true, access_token: true },
    });
  }

  async getLightAccessLink(token: string) {
    const slot = await this.prisma.teamSlot.findUnique({
      where: { access_token: token },
      select: {
        id: true, name: true, desk_access: true,
        tenant: { select: { id: true, name: true } },
      },
    });
    if (!slot || slot.desk_access !== 'LIGHT') {
      throw new NotFoundException('Link inválido o expirado');
    }
    return slot;
  }

  // ─── Health score ───────────────────────────────────────────────────────────

  private async computeHealth(tenant: { id: string; [key: string]: any }) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const todayStart  = new Date(new Date().setHours(0, 0, 0, 0));

    const [activeHumans, completedTasks, overdueTasks, recentConversations, activeAgents] = await Promise.all([
      this.prisma.teamSlot.count({ where: { tenant_id: tenant.id, type: 'HUMAN', status: 'ONLINE' } }),
      this.prisma.task.count({ where: { tenant_id: tenant.id, status: 'completed', completed_at: { gte: todayStart } } }),
      this.prisma.task.count({ where: { tenant_id: tenant.id, status: { in: ['pending', 'in_progress'] }, due_date: { lt: todayStart } } }),
      this.prisma.agentConversation.count({ where: { tenant_id: tenant.id, started_at: { gte: sevenDaysAgo } } }),
      this.prisma.teamSlot.count({ where: { tenant_id: tenant.id, type: 'AI_AGENT', status: 'ONLINE' } }),
    ]);

    // Score 0-100: penaliza vencidas, premia completadas y actividad
    let score = 70;
    if (overdueTasks > 0) score -= Math.min(overdueTasks * 5, 30);
    if (completedTasks > 0) score += Math.min(completedTasks * 3, 15);
    if (recentConversations > 0) score += Math.min(recentConversations * 2, 10);
    if (activeAgents > 0) score += 5;
    score = Math.max(0, Math.min(100, score));

    const healthLabel =
      score >= 80 ? 'saludable' :
      score >= 55 ? 'atención' : 'crítico';

    return {
      ...tenant,
      health: { score, label: healthLabel, active_humans: activeHumans, active_agents: activeAgents, completed_today: completedTasks, overdue_tasks: overdueTasks, recent_conversations: recentConversations },
    };
  }
}
