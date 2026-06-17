import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantExportService } from './tenant-export.service';

import { randomBytes } from 'crypto';

const PLAN_PRICE: Record<string, number> = { starter: 49, professional: 149, enterprise: 399, internal: 0 };

@Injectable()
export class PlatformService {
  constructor(
    private prisma: PrismaService,
    private tenantExport: TenantExportService,
  ) {}

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

    // Export all tenant data + decrypt vault for real .env values
    const { sql: dataSql, vault, stats } = await this.tenantExport.exportTenant(targetId);

    const encryptionKey = process.env.ENCRYPTION_KEY ?? 'REEMPLAZAR_CON_TU_ENCRYPTION_KEY_ACTUAL';

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
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  desk:
    image: ghcr.io/mentoria/flowdesk-desk:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      - NEXT_PUBLIC_API_URL=\${FRONTEND_API_URL:-http://localhost:3001/api/v1}

  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_DB: flowdesk
      POSTGRES_USER: flowdesk
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flowdesk -d flowdesk"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
`;

    // Build .env with REAL values from the vault
    const vaultLines = Object.entries(vault).map(([k, v]) => `${k}=${v}`).join('\n');

    const envContent = `# ════════════════════════════════════════════════════════
# FlowDesk — Configuración de servidor propio
# Cliente: ${tenant.name} (${slug})
# Generado: ${new Date().toISOString()}
#
# ⚠️  AVISO DE SEGURIDAD:
#   - Cambia POSTGRES_PASSWORD y JWT_SECRET antes de levantar
#   - Guarda este archivo con permisos 600 (chmod 600 .env)
#   - Después de verificar que todo funciona, rota ENCRYPTION_KEY
# ════════════════════════════════════════════════════════

# ── Base de datos ─────────────────────────────────────────
DATABASE_URL=postgresql://flowdesk:\${POSTGRES_PASSWORD}@postgres:5432/flowdesk?schema=public
POSTGRES_PASSWORD=CAMBIAR_POR_CONTRASEÑA_SEGURA_16+_CHARS

# ── Seguridad ─────────────────────────────────────────────
JWT_SECRET=GENERAR_CON: openssl rand -hex 32

# ── Cifrado (CRÍTICO — igual al original para descifrar datos del Vault) ──
# Después de migrar y verificar, puedes rotar esta clave con el comando:
#   docker compose exec api npx ts-node scripts/rotate-encryption-key.ts
ENCRYPTION_KEY=${encryptionKey}

# ── App ───────────────────────────────────────────────────
NODE_ENV=production
PORT=3001
FRONTEND_URL=http://localhost:3000
FRONTEND_API_URL=http://localhost:3001/api/v1

# ── Supabase Storage (necesitas tu propio proyecto Supabase) ─
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_SERVICE_KEY=TU_SUPABASE_SERVICE_KEY
SUPABASE_ANON_KEY=TU_SUPABASE_ANON_KEY

# ── IA ────────────────────────────────────────────────────
ANTHROPIC_API_KEY=${vault['ANTHROPIC_API_KEY'] ?? 'TU_ANTHROPIC_API_KEY'}
OPENAI_API_KEY=${vault['OPENAI_API_KEY'] ?? vault['OPENAI_KEY'] ?? 'TU_OPENAI_API_KEY'}

# ── WhatsApp / Evolution API ──────────────────────────────
EVOLUTION_API_URL=${vault['EVOLUTION_API_URL'] ?? 'http://evolution:8080'}
EVOLUTION_API_KEY=${vault['EVOLUTION_API_KEY'] ?? vault['EVOLUTION_KEY'] ?? 'TU_EVOLUTION_KEY'}
EVOLUTION_INSTANCE=${tenant.secretary_config?.evolution_instance ?? slug + '-wa'}

# ── Búsqueda web ─────────────────────────────────────────
BRAVE_SEARCH_API_KEY=${vault['BRAVE_SEARCH_API_KEY'] ?? vault['BRAVE_API_KEY'] ?? ''}
FIRECRAWL_API_KEY=${vault['FIRECRAWL_API_KEY'] ?? ''}

# ── Otras credenciales del Vault (extraídas automáticamente) ──
${vaultLines}

# ── Tenant raíz ──────────────────────────────────────────
ROOT_TENANT_SLUG=${slug}
ROOT_OWNER_EMAIL=${owner?.email ?? 'admin@' + slug + '.com'}
ROOT_OWNER_NAME=${owner?.name ?? 'Administrador'}
`;

    const setupSh = `#!/bin/bash
# ════════════════════════════════════════════════════════
# FlowDesk — Script de instalación en servidor propio
# Cliente: ${tenant.name}
# ════════════════════════════════════════════════════════
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   FlowDesk — Instalación Self-Hosted      ║"
echo "║   Cliente: ${(tenant.name + ' ').padEnd(27).slice(0, 27)}  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Verificar dependencias ────────────────────────────────
command -v docker &>/dev/null || { echo "❌ Docker no encontrado. Instala desde https://docs.docker.com/get-docker/"; exit 1; }
command -v docker &>/dev/null && docker compose version &>/dev/null || { echo "❌ Docker Compose v2 no encontrado."; exit 1; }

if [ ! -f .env ]; then
  echo "❌ Falta el archivo .env"
  echo "   Copia .env.example a .env y configura los valores"
  exit 1
fi

echo "✓ Docker encontrado"
echo "✓ Archivo .env encontrado"
echo ""

# ── Cargar variables ──────────────────────────────────────
set -a; source .env; set +a

# ── Levantar base de datos y Redis ────────────────────────
echo "▶ Levantando PostgreSQL y Redis..."
docker compose up -d postgres redis

echo "⏳ Esperando que PostgreSQL esté lista..."
until docker compose exec -T postgres pg_isready -U flowdesk -d flowdesk 2>/dev/null; do
  printf "."
  sleep 2
done
echo ""
echo "✓ PostgreSQL lista"

# ── Habilitar pgvector ────────────────────────────────────
echo "▶ Habilitando extensión pgvector..."
docker compose exec -T postgres psql -U flowdesk -d flowdesk \\
  -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true

# ── Aplicar schema de Prisma ──────────────────────────────
echo "▶ Aplicando schema de base de datos..."
docker compose run --rm api npx prisma migrate deploy
echo "✓ Schema aplicado"

# ── Importar datos del tenant ─────────────────────────────
if [ -f "data.sql" ]; then
  echo "▶ Importando datos (puede tardar según el volumen)..."
  docker compose exec -T postgres psql -U flowdesk -d flowdesk < data.sql
  echo "✓ Datos importados correctamente"
else
  echo "⚠️  data.sql no encontrado — la instancia arrancará sin datos históricos"
  echo "   Descárgalo desde FlowDesk Admin → Clientes → Exportar datos"
fi

# ── Levantar todos los servicios ──────────────────────────
echo "▶ Iniciando FlowDesk..."
docker compose up -d
echo ""
echo "══════════════════════════════════════════"
echo "  ✅  FlowDesk instalado correctamente"
echo ""
echo "  API:   http://localhost:3001"
echo "  App:   http://localhost:3000"
echo ""
echo "  ⚠️  Pendientes antes de producción:"
echo "     1. Configurar tu dominio en el DNS"
echo "     2. Actualizar FRONTEND_URL y FRONTEND_API_URL en .env"
echo "     3. Cambiar POSTGRES_PASSWORD y JWT_SECRET"
echo "     4. Verificar que el Vault funciona correctamente"
echo "     5. Cambiar ENCRYPTION_KEY (después de verificar)"
echo "══════════════════════════════════════════"
`;

    const instructions = `# FlowDesk Self-Hosted — Guía de instalación
## Cliente: ${tenant.name}

---

## Archivos incluidos en este paquete

| Archivo | Descripción |
|---------|-------------|
| \`docker-compose.yml\` | Stack completo: API, Frontend, PostgreSQL + pgvector, Redis |
| \`.env\` | Variables de entorno con tus valores reales |
| \`setup.sh\` | Script automatizado de instalación (recomendado) |
| \`data.sql\` | Exportación completa de tu base de datos |
| \`INSTALL.md\` | Esta guía |

---

## Requisitos del servidor

- **SO**: Ubuntu 22.04 LTS o Debian 12 (recomendado)
- **RAM**: 4 GB mínimo, 8 GB recomendado
- **Disco**: 20 GB mínimo
- **Docker**: v24+ con Docker Compose v2
- **Puertos abiertos**: 80, 443 (y 3000/3001 para pruebas locales)

---

## Instalación rápida (script automatizado)

\`\`\`bash
chmod +x setup.sh
./setup.sh
\`\`\`

---

## Instalación manual paso a paso

### 1. Configurar variables de entorno

\`\`\`bash
# Edita los valores marcados como CAMBIAR en .env
nano .env
\`\`\`

**Variables críticas a cambiar:**
- \`POSTGRES_PASSWORD\` — contraseña de la base de datos
- \`JWT_SECRET\` — genera con: \`openssl rand -hex 32\`

**Variables críticas a NO cambiar (por ahora):**
- \`ENCRYPTION_KEY\` — necesaria para descifrar tus datos del Vault

### 2. Levantar servicios

\`\`\`bash
docker compose up -d
\`\`\`

### 3. Aplicar schema

\`\`\`bash
docker compose run --rm api npx prisma migrate deploy
\`\`\`

### 4. Importar tus datos

\`\`\`bash
docker compose exec -T postgres psql -U flowdesk -d flowdesk < data.sql
\`\`\`

### 5. Verificar

Abre \`http://localhost:3000\` en tu navegador. Inicia sesión con tus credenciales habituales.

---

## Configurar dominio propio

1. Apunta tu dominio a la IP del servidor (registro A en DNS)
2. Instala un reverse proxy (Nginx/Caddy) con SSL
3. Actualiza en \`.env\`:
   \`\`\`
   FRONTEND_URL=https://tudominio.com
   FRONTEND_API_URL=https://api.tudominio.com/api/v1
   \`\`\`
4. Reinicia: \`docker compose restart\`

---

## Resumen de datos exportados

${stats.filter(s => s.count > 0).map(s => `- **${s.table}**: ${s.count} registros`).join('\n')}

---

## Soporte post-migración

- Email: soporte@flowdesk.mx
- Horario: Lunes a Viernes, 9:00 - 18:00 CST
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
      env_content: envContent,
      setup_sh: setupSh,
      install_md: instructions,
      data_sql: dataSql,
      export_stats: stats.filter(s => s.count > 0),
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
