import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { randomBytes } from 'crypto';

const PLAN_PRICE: Record<string, number> = { starter: 49, professional: 149, enterprise: 399, internal: 0 };

@Injectable()
export class PlatformService {
  constructor(private prisma: PrismaService) {}

  private async assertPlatform(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { tenant_type: true, campus_config: true },
    });
    const cfg = (t?.campus_config as Record<string, unknown>) ?? {};
    const hasPlatformAccess = t?.tenant_type === 'PLATFORM' || !!cfg.include_platform_metrics;
    if (!hasPlatformAccess) throw new ForbiddenException('Acceso restringido a la plataforma.');
  }

  private async assertNetworkOrAbove(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { tenant_type: true } });
    if (!t || (t.tenant_type !== 'PLATFORM' && t.tenant_type !== 'NETWORK'))
      throw new ForbiddenException('Acceso restringido a administradores de red.');
  }

  // ─── PLATFORM: vista global enriquecida ────────────────────────────────────

  async getNetwork(callerTenantId: string) {
    await this.assertPlatform(callerTenantId);

    const tenants = await this.prisma.tenant.findMany({
      where: { tenant_type: { in: ['NETWORK', 'BRANCH'] } },
      select: {
        id: true, name: true, slug: true, tenant_type: true, status: true,
        plan: true, campus_config: true, created_at: true,
        team_slots: {
          where: { role: 'owner', type: 'HUMAN' },
          select: { name: true, email: true },
          take: 1,
        },
        secretary_config: { select: { enabled: true, owner_phone: true } },
        billing_config:   { select: { enabled: true, rfc: true } },
        _count: {
          select: { team_slots: true, brain_documents: true, agent_conversations: true },
        },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });

    return tenants.map(t => {
      const cfg = (t.campus_config as Record<string, unknown>) ?? {};
      return {
        ...t,
        account_type: (cfg.account_type as string) ?? 'company',
        owner: t.team_slots[0] ?? null,
        mrr: t.status === 'active' ? (PLAN_PRICE[t.plan] ?? 0) : 0,
      };
    });
  }

  async getNetworkStats(callerTenantId: string) {
    await this.assertPlatform(callerTenantId);

    const [total, active, byPlan, totalBrainDocs, totalConversations] = await Promise.all([
      this.prisma.tenant.count({ where: { tenant_type: { in: ['NETWORK', 'BRANCH'] } } }),
      this.prisma.tenant.count({ where: { tenant_type: { in: ['NETWORK', 'BRANCH'] }, status: 'active' } }),
      this.prisma.tenant.groupBy({ by: ['plan'], where: { tenant_type: { in: ['NETWORK', 'BRANCH'] }, status: 'active' }, _count: true }),
      this.prisma.empresaBrainDocument.count(),
      this.prisma.agentConversation.count(),
    ]);

    const planMap = Object.fromEntries(byPlan.map(p => [p.plan, p._count]));
    const mrr = byPlan.reduce((s, p) => s + p._count * (PLAN_PRICE[p.plan] ?? 0), 0);

    return { total, active, mrr, plans: planMap, brain_docs: totalBrainDocs, conversations: totalConversations };
  }

  async getTenantDetail(callerTenantId: string, targetTenantId: string) {
    await this.assertPlatform(callerTenantId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: targetTenantId },
      include: {
        team_slots: {
          select: { id: true, name: true, email: true, role: true, type: true, status: true, agent_role: true },
          orderBy: [{ type: 'asc' }, { role: 'asc' }],
        },
        secretary_config: true,
        billing_config: true,
        _count: { select: { team_slots: true, brain_documents: true, agent_conversations: true, contacts: true, tasks: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const [deals, onboardingProgress] = await Promise.all([
      this.prisma.deal.aggregate({
        where: { tenant_id: targetTenantId, status: 'open' },
        _count: true, _sum: { value: true },
      }),
      this.prisma.onboardingProgress.findUnique({
        where: { tenant_id: targetTenantId },
        select: { current_step: true, completed_at: true, steps_completed: true },
      }),
    ]);

    const cfg = (tenant.campus_config as Record<string, unknown>) ?? {};
    const health = await this.computeHealth(tenant);

    return {
      ...tenant,
      account_type:       (cfg.account_type as string) ?? 'company',
      mrr:                tenant.status === 'active' ? (PLAN_PRICE[tenant.plan] ?? 0) : 0,
      health:             health.health,
      open_deals:         deals._count,
      pipeline_value:     deals._sum.value ?? 0,
      onboarding:         onboardingProgress,
    };
  }

  async updateStatus(callerTenantId: string, targetId: string, status: 'active' | 'suspended' | 'cancelled') {
    await this.assertPlatform(callerTenantId);
    return this.prisma.tenant.update({ where: { id: targetId }, data: { status } });
  }

  async updatePlan(callerTenantId: string, targetId: string, plan: string) {
    await this.assertPlatform(callerTenantId);
    return this.prisma.tenant.update({ where: { id: targetId }, data: { plan } });
  }

  async updateAccountType(callerTenantId: string, targetId: string, account_type: string) {
    await this.assertPlatform(callerTenantId);
    const existing = await this.prisma.tenant.findUnique({ where: { id: targetId }, select: { campus_config: true } });
    const cfg = (existing?.campus_config as Record<string, unknown>) ?? {};
    return this.prisma.tenant.update({ where: { id: targetId }, data: { campus_config: { ...cfg, account_type } } });
  }

  // ─── PLATFORM: migración a servidor propio ─────────────────────────────────

  async generateMigrationBundle(callerTenantId: string, targetId: string) {
    await this.assertPlatform(callerTenantId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: targetId },
      include: {
        team_slots: { where: { role: 'owner', type: 'HUMAN' }, select: { name: true, email: true }, take: 1 },
        secretary_config: { select: { evolution_instance: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const slug = tenant.slug;
    const owner = tenant.team_slots[0];

    const dockerCompose = `version: '3.8'
services:
  api:
    image: ghcr.io/mentoria/flowdesk-api:latest
    restart: unless-stopped
    ports:
      - "3001:3001"
    env_file:
      - .env
    depends_on:
      - postgres
      - redis

  desk:
    image: ghcr.io/mentoria/flowdesk-desk:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://api:3001/api/v1

  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_DB: flowdesk
      POSTGRES_USER: flowdesk
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped

volumes:
  pgdata:
`;

    const envTemplate = `# ── Base de datos ────────────────────────────────────────────
DATABASE_URL=postgresql://flowdesk:\${POSTGRES_PASSWORD}@postgres:5432/flowdesk?schema=public
POSTGRES_PASSWORD=CAMBIAR_ESTO_POR_CONTRASEÑA_SEGURA

# ── JWT ──────────────────────────────────────────────────────
JWT_SECRET=CAMBIAR_ESTO_POR_SECRET_DE_AL_MENOS_64_CARACTERES

# ── Supabase Storage (o usar almacenamiento propio) ──────────
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_SERVICE_KEY=TU_SUPABASE_SERVICE_KEY

# ── OpenAI / Proveedor de IA ─────────────────────────────────
OPENAI_API_KEY=TU_OPENAI_API_KEY
ANTHROPIC_API_KEY=TU_ANTHROPIC_API_KEY

# ── Evolution API (WhatsApp) ──────────────────────────────────
EVOLUTION_API_URL=http://evolution:8080
EVOLUTION_API_KEY=TU_EVOLUTION_KEY
EVOLUTION_INSTANCE=${tenant.secretary_config?.evolution_instance ?? slug + '-instance'}

# ── Tenant raíz (se crea automáticamente en primer boot) ────
ROOT_TENANT_SLUG=${slug}
ROOT_OWNER_EMAIL=${owner?.email ?? 'admin@' + slug + '.com'}
ROOT_OWNER_NAME=${owner?.name ?? 'Administrador'}

# ── App ──────────────────────────────────────────────────────
NODE_ENV=production
PORT=3001
FRONTEND_URL=http://localhost:3000
`;

    const instructions = `# Guía de instalación — FlowDesk Self-Hosted

## Requisitos
- Docker + Docker Compose v2
- 4 GB RAM mínimo (8 GB recomendado)
- Dominio propio (opcional pero recomendado)

## Pasos

1. Copia los archivos docker-compose.yml y .env en un directorio vacío
2. Edita .env con tus valores reales
3. Levanta los servicios:
   \`\`\`
   docker compose up -d
   \`\`\`
4. Crea la base de datos (primera vez):
   \`\`\`
   docker compose exec api npx prisma migrate deploy
   \`\`\`
5. Importa los datos exportados desde FlowDesk Cloud:
   \`\`\`
   docker compose exec -i postgres psql -U flowdesk flowdesk < flowdesk-export.sql
   \`\`\`

## Soporte
Para soporte de instalación: soporte@flowdesk.mx
`;

    // Marcar tenant como bundle_generated
    await this.prisma.tenant.update({
      where: { id: targetId },
      data: { migration_status: 'bundle_generated', migration_at: new Date() },
    });

    return {
      tenant_name: tenant.name,
      tenant_slug: slug,
      docker_compose: dockerCompose,
      env_template: envTemplate,
      instructions,
      generated_at: new Date().toISOString(),
    };
  }

  // ─── PLATFORM: provisionar nuevo tenant ────────────────────────────────────

  async provisionTenant(callerTenantId: string, dto: {
    name: string; slug: string; tenant_type: 'NETWORK' | 'BRANCH';
    network_id?: string; external_ref?: string; plan?: string;
    owner_email: string; owner_name: string;
  }) {
    await this.assertPlatform(callerTenantId);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name, slug: dto.slug, tenant_type: dto.tenant_type,
          network_id: dto.network_id ?? null, external_ref: dto.external_ref ?? null,
          plan: dto.plan ?? 'starter', status: 'active',
        },
      });

      const ownerSlot = await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id, name: dto.owner_name, email: dto.owner_email,
          type: 'HUMAN', role: 'owner', status: 'OFFLINE', desk_access: 'FULL',
        },
      });

      await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id, name: 'Atlas', type: 'AI_AGENT', role: 'employee',
          status: 'ONLINE', agent_role: 'ceo', agent_scope: 'personal',
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

  // ─── NETWORK: gestión de sucursales propias ─────────────────────────────────

  async getMyBranches(callerTenantId: string) {
    await this.assertNetworkOrAbove(callerTenantId);
    const caller = await this.prisma.tenant.findUnique({ where: { id: callerTenantId }, select: { tenant_type: true } });
    const where = caller?.tenant_type === 'PLATFORM' ? { tenant_type: 'BRANCH' as const } : { network_id: callerTenantId };
    const branches = await this.prisma.tenant.findMany({
      where, select: { id: true, name: true, slug: true, status: true, external_ref: true, plan: true, created_at: true, _count: { select: { team_slots: true } } },
      orderBy: { name: 'asc' },
    });
    return Promise.all(branches.map(b => this.computeHealth(b)));
  }

  async provisionBranch(callerTenantId: string, dto: {
    name: string; slug: string; external_ref?: string;
    employee_desks_enabled?: boolean; owner_email: string; owner_name: string;
  }) {
    await this.assertNetworkOrAbove(callerTenantId);
    const caller = await this.prisma.tenant.findUnique({ where: { id: callerTenantId }, select: { tenant_type: true, plan: true } });
    const networkId = caller?.tenant_type === 'NETWORK' ? callerTenantId : undefined;

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.name, slug: dto.slug, tenant_type: 'BRANCH', network_id: networkId ?? null, external_ref: dto.external_ref ?? null, plan: caller?.plan ?? 'starter', status: 'active' },
      });
      const ownerSlot = await tx.teamSlot.create({
        data: { tenant_id: tenant.id, name: dto.owner_name, email: dto.owner_email, type: 'HUMAN', role: 'owner', status: 'OFFLINE', desk_access: 'FULL' },
      });
      await tx.teamSlot.create({
        data: { tenant_id: tenant.id, name: 'Atlas', type: 'AI_AGENT', role: 'employee', status: 'ONLINE', agent_role: 'ceo', agent_scope: 'personal', owner_slot_id: ownerSlot.id, agent_config: { model: 'claude-sonnet-4-6', instructions: `Soy Atlas, CEO Agent de ${dto.name}.`, tools: [] } },
      });
      return { tenant, owner_slot_id: ownerSlot.id };
    });
  }

  // ─── Empleado access ──────────────────────────────────────────────────────

  async setEmployeeAccess(callerTenantId: string, slotId: string, access: 'FULL' | 'LIGHT' | 'NONE') {
    const slot = await this.prisma.teamSlot.findFirst({ where: { id: slotId, tenant_id: callerTenantId, type: 'HUMAN' } });
    if (!slot) throw new NotFoundException('Empleado no encontrado');
    const data: any = { desk_access: access };
    if (access === 'LIGHT' && !slot.access_token) data.access_token = randomBytes(16).toString('hex');
    if (access !== 'LIGHT') data.access_token = null;
    return this.prisma.teamSlot.update({ where: { id: slotId }, data, select: { id: true, name: true, desk_access: true, access_token: true } });
  }

  async getLightAccessLink(token: string) {
    const slot = await this.prisma.teamSlot.findUnique({
      where: { access_token: token },
      select: { id: true, name: true, desk_access: true, tenant: { select: { id: true, name: true } } },
    });
    if (!slot || slot.desk_access !== 'LIGHT') throw new NotFoundException('Link inválido o expirado');
    return slot;
  }

  // ─── Health score ─────────────────────────────────────────────────────────

  private async computeHealth(tenant: { id: string; [key: string]: any }) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const todayStart   = new Date(new Date().setHours(0, 0, 0, 0));

    const [activeHumans, completedTasks, overdueTasks, recentConversations, activeAgents] = await Promise.all([
      this.prisma.teamSlot.count({ where: { tenant_id: tenant.id, type: 'HUMAN', status: 'ONLINE' } }),
      this.prisma.task.count({ where: { tenant_id: tenant.id, status: 'completed', completed_at: { gte: todayStart } } }),
      this.prisma.task.count({ where: { tenant_id: tenant.id, status: { in: ['pending', 'in_progress'] }, due_date: { lt: todayStart } } }),
      this.prisma.agentConversation.count({ where: { tenant_id: tenant.id, started_at: { gte: sevenDaysAgo } } }),
      this.prisma.teamSlot.count({ where: { tenant_id: tenant.id, type: 'AI_AGENT', status: 'ONLINE' } }),
    ]);

    let score = 70;
    if (overdueTasks > 0)       score -= Math.min(overdueTasks * 5, 30);
    if (completedTasks > 0)     score += Math.min(completedTasks * 3, 15);
    if (recentConversations > 0)score += Math.min(recentConversations * 2, 10);
    if (activeAgents > 0)       score += 5;
    score = Math.max(0, Math.min(100, score));

    return {
      ...tenant,
      health: {
        score, label: score >= 80 ? 'saludable' : score >= 55 ? 'atención' : 'crítico',
        active_humans: activeHumans, active_agents: activeAgents,
        completed_today: completedTasks, overdue_tasks: overdueTasks, recent_conversations: recentConversations,
      },
    };
  }
}
