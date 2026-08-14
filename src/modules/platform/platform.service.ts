import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { TenantExportService } from './tenant-export.service';
import { EmailService } from '../email/email.service';

import { randomBytes } from 'crypto';

const PLAN_PRICE: Record<string, number> = { starter: 49, professional: 149, enterprise: 399, internal: 0 };

@Injectable()
export class PlatformService {
  constructor(
    private prisma: PrismaService,
    private tenantExport: TenantExportService,
    private jwt: JwtService,
    private config: ConfigService,
    private email: EmailService,
  ) {}

  private async assertPlatform(tenantId: string) {
    // El tenant del superadmin siempre tiene acceso a la plataforma
    const hasSuperAdmin = await this.prisma.teamSlot.count({ where: { tenant_id: tenantId, role: 'superadmin' } });
    if (hasSuperAdmin > 0) return;

    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { tenant_type: true, campus_config: true },
    });
    const cfg = (t?.campus_config as Record<string, unknown>) ?? {};
    const hasPlatformAccess = t?.tenant_type === 'PLATFORM' || !!cfg.include_platform_metrics;
    if (!hasPlatformAccess) throw new ForbiddenException('Acceso restringido a la plataforma.');
  }

  // Expuesto para el controller de auditoría
  async assertPlatformAccess(tenantId: string) {
    return this.assertPlatform(tenantId);
  }

  async setMigratedUrl(targetId: string, self_hosted_url: string) {
    return this.prisma.tenant.update({
      where: { id: targetId },
      data: { migration_status: 'migrated', self_hosted_url, migration_at: new Date() },
      select: { id: true, migration_status: true, self_hosted_url: true, migration_at: true },
    });
  }

  private async assertNetworkOrAbove(tenantId: string) {
    const hasSuperAdmin = await this.prisma.teamSlot.count({ where: { tenant_id: tenantId, role: 'superadmin' } });
    if (hasSuperAdmin > 0) return;
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
        plan: true, campus_config: true, created_at: true, web_builder_enabled: true, communications_enabled: true,
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

  async toggleWebBuilder(callerTenantId: string, targetId: string, enabled: boolean) {
    await this.assertPlatform(callerTenantId);
    return this.prisma.tenant.update({ where: { id: targetId }, data: { web_builder_enabled: enabled } });
  }

  async toggleCommunications(callerTenantId: string, targetId: string, enabled: boolean) {
    await this.assertPlatform(callerTenantId);
    return this.prisma.tenant.update({ where: { id: targetId }, data: { communications_enabled: enabled } });
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
    return this.buildBundle(targetId);
  }

  private async buildBundle(targetId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where:   { id: targetId },
      include: {
        team_slots:       { where: { role: 'owner', type: 'HUMAN' }, select: { name: true, email: true }, take: 1 },
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

    // Verification script with expected counts embedded
    const expectedCountsBlock = stats
      .filter(s => s.count > 0)
      .map(s => `  check "${s.table}" "$(psql_count \\"${s.table}\\")" "${s.count}"`)
      .join('\n');

    const verifySh = `#!/bin/bash
# ════════════════════════════════════════════════════════
# FlowDesk — Script de verificación post-migración
# Cliente: ${tenant.name} (${slug})
# Exportado: ${new Date().toISOString()}
# ════════════════════════════════════════════════════════
set -e

ERRORS=0
WARNINGS=0

ok()   { echo "  ✅ $1"; }
warn() { echo "  ⚠️  $1"; WARNINGS=$((WARNINGS+1)); }
fail() { echo "  ❌ $1"; ERRORS=$((ERRORS+1)); }

psql_count() {
  docker compose exec -T postgres psql -U flowdesk -d flowdesk -At \\
    -c "SELECT COUNT(*) FROM \\"$1\\"" 2>/dev/null || echo "ERROR"
}

check() {
  local name=$1 actual=$2 expected=$3
  if [ "$actual" = "$expected" ]; then
    ok "$name: $actual/$expected registros"
  elif [ "$actual" = "ERROR" ]; then
    fail "$name: tabla no accesible"
  else
    warn "$name: $actual registros (esperados $expected)"
  fi
}

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  FlowDesk — Verificación de migración         ║"
echo "║  Cliente: ${(tenant.name + '                         ').slice(0, 30)} ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Docker y servicios ─────────────────────────────
echo "── Servicios Docker ──"
if docker compose ps | grep -q "Up"; then
  ok "Servicios Docker en ejecución"
else
  fail "Los servicios Docker no están corriendo — ejecuta: docker compose up -d"
fi

# ── 2. PostgreSQL ─────────────────────────────────────
echo ""
echo "── Base de datos ──"
if docker compose exec -T postgres pg_isready -U flowdesk -d flowdesk &>/dev/null; then
  ok "PostgreSQL responde"
else
  fail "PostgreSQL no responde"
fi

# Verificar extensión pgvector
VECTOR_EXT=$(docker compose exec -T postgres psql -U flowdesk -d flowdesk -At -c "SELECT COUNT(*) FROM pg_extension WHERE extname='vector'" 2>/dev/null || echo "0")
if [ "$VECTOR_EXT" = "1" ]; then
  ok "Extensión pgvector instalada"
else
  warn "pgvector no encontrada — los embeddings del Brain no funcionarán"
fi

# ── 3. Conteo de tablas ───────────────────────────────
echo ""
echo "── Registros por tabla ──"
${expectedCountsBlock}

# ── 4. API ────────────────────────────────────────────
echo ""
echo "── API HTTP ──"
API_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/v1/health 2>/dev/null || echo "000")
if [ "$API_CODE" = "200" ] || [ "$API_CODE" = "204" ]; then
  ok "API respondiendo (HTTP $API_CODE)"
else
  warn "API en http://localhost:3001 no responde (HTTP $API_CODE). Puede estar iniciando."
fi

DESK_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
if [ "$DESK_CODE" = "200" ] || [ "$DESK_CODE" = "304" ]; then
  ok "Frontend respondiendo (HTTP $DESK_CODE)"
else
  warn "Frontend en http://localhost:3000 no responde (HTTP $DESK_CODE). Puede estar compilando."
fi

# ── 5. Resultado ──────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo "  ✅ Migración verificada al 100%"
elif [ "$ERRORS" -eq 0 ]; then
  echo "  ⚠️  $WARNINGS advertencias — revisa los detalles arriba"
else
  echo "  ❌ $ERRORS errores críticos + $WARNINGS advertencias"
  echo "     Consulta INSTALL.md sección 'Solución de problemas'"
fi
echo "══════════════════════════════════════════════════"
echo ""
`;

    const migrationManual = `# Manual de Migración FlowDesk
## De SaaS Cloud a Servidor Propio — Guía Completa

**Cliente:** ${tenant.name} · **Slug:** ${slug}
**Generado:** ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

---

## 1. ¿Qué significa esta migración?

Al completar este proceso, la empresa **${tenant.name}** tendrá:

- Una **copia exacta e idéntica** de su FlowDesk (equipo, agentes, conversaciones, datos de CRM, Brain, etc.)
- **Propiedad perpetua** del software — sin pagos mensuales de SaaS
- **Independencia total** de FlowDesk Cloud — pueden operar aunque MentorIA dejara de existir
- **Datos bajo su control** en su propia infraestructura (nube propia o servidor físico)

> ⚠️ Después de la migración, las actualizaciones de software se contratan por separado con MentorIA o se aplican manualmente.

---

## 2. Archivos del paquete de migración

| Archivo | Descripción | Cuándo usar |
|---------|-------------|-------------|
| \`docker-compose.yml\` | Stack completo de FlowDesk | Siempre, base de todo |
| \`.env\` | Variables de entorno con valores reales | Editar antes de instalar |
| \`setup.sh\` | Instalación automática | Primer arranque |
| \`${slug}-data.sql\` | Todos los datos del tenant en SQL | Import post-schema |
| \`verify.sh\` | Verificación post-instalación | Después de importar datos |
| \`INSTALL.md\` | Guía técnica de instalación | Referencia durante install |

---

## 3. Requisitos del servidor destino

### Mínimo recomendado
| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| RAM | 4 GB | 8 GB |
| CPU | 2 vCPUs | 4 vCPUs |
| Disco | 20 GB | 60 GB SSD |
| OS | Ubuntu 22.04 | Ubuntu 22.04 LTS |

### Software requerido
- **Docker** v24 o superior
- **Docker Compose** v2 (incluido en Docker Desktop)
- **curl** (para verificaciones)
- Acceso SSH al servidor

### Puertos necesarios
| Puerto | Servicio | Acceso |
|--------|---------|--------|
| 22 | SSH | Solo IPs de admin |
| 80 | HTTP → redirect HTTPS | Público |
| 443 | HTTPS (app + API) | Público |
| 5432 | PostgreSQL | Solo localhost |
| 6379 | Redis | Solo localhost |

---

## 4. Proceso de migración paso a paso

### Fase 1 — Preparación (FlowDesk Cloud)

**4.1. Ejecutar auditoría pre-migración**
En el panel de admin de FlowDesk, ve a **Admin → Clientes → ${tenant.name} → Revisar migración** y ejecuta la auditoría. Asegúrate de que todos los checks sean ✅ o ⚠️ (sin ❌).

**4.2. Descargar el paquete completo**
Descarga los 6 archivos. Guárdalos en un directorio seguro.

**4.3. Revisar el archivo .env**
Abre \`.env\` y verifica/completa:
- \`POSTGRES_PASSWORD\` — cámbialo por una contraseña segura
- \`JWT_SECRET\` — genera uno nuevo: \`openssl rand -hex 32\`
- \`SUPABASE_URL\` y \`SUPABASE_SERVICE_KEY\` — tu proyecto Supabase propio
- Las demás variables ya vienen pre-rellenadas con tus valores reales

---

### Fase 2 — Instalación en el servidor

**4.4. Subir archivos al servidor**
\`\`\`bash
# Crear directorio
ssh usuario@tu-servidor "mkdir -p /opt/flowdesk"

# Subir archivos
scp docker-compose.yml .env setup.sh ${slug}-data.sql verify.sh INSTALL.md \\
    usuario@tu-servidor:/opt/flowdesk/
\`\`\`

**4.5. Conectarse al servidor y ejecutar setup**
\`\`\`bash
ssh usuario@tu-servidor
cd /opt/flowdesk

# Dar permisos de ejecución
chmod +x setup.sh verify.sh

# Ejecutar instalación automática
./setup.sh
\`\`\`

El script hace automáticamente:
1. Levanta PostgreSQL y Redis
2. Espera a que PostgreSQL esté lista
3. Habilita la extensión \`pgvector\`
4. Aplica el schema de Prisma (\`migrate deploy\`)
5. Importa \`${slug}-data.sql\` con todos tus datos
6. Levanta la API y el frontend

**Si prefieres instalación manual**, sigue los pasos en \`INSTALL.md\`.

---

### Fase 3 — Verificación

**4.6. Ejecutar script de verificación**
\`\`\`bash
./verify.sh
\`\`\`

Resultado esperado:
\`\`\`
  ✅ Servicios Docker en ejecución
  ✅ PostgreSQL responde
  ✅ pgvector instalada
  ✅ Tenant: 1/1 registros
  ✅ TeamSlot: XX/XX registros
  ... (todos los checks en verde)
  ✅ API respondiendo
  ✅ Migración verificada al 100%
\`\`\`

**4.7. Verificación manual — iniciar sesión**
1. Abre \`http://localhost:3000\` (o tu dominio si ya está configurado)
2. Inicia sesión con tus credenciales habituales
3. Verifica que puedas ver tu equipo, agentes, conversaciones y datos

**4.8. Verificar agentes de IA**
1. Ve a **Agentes**
2. Abre una conversación con **Atlas** (tu CEO Agent)
3. Si Atlas responde correctamente, el Vault está bien configurado

**4.9. Verificar el Brain**
1. Ve a **Brain**
2. Haz una búsqueda sobre un tema que sepas que está documentado
3. Si devuelve resultados, los vectores están intactos

---

### Fase 4 — Configurar dominio propio

**4.10. DNS**
En tu proveedor de dominios, crea dos registros A:
\`\`\`
tudominio.com       → IP de tu servidor
api.tudominio.com   → IP de tu servidor
\`\`\`
O usa un subdominio:
\`\`\`
flowdesk.tuempresa.com     → IP de tu servidor
api.flowdesk.tuempresa.com → IP de tu servidor
\`\`\`

**4.11. Reverse proxy con Nginx + SSL (Certbot)**
\`\`\`bash
# Instalar Nginx y Certbot
sudo apt install nginx certbot python3-certbot-nginx

# Crear configuración para la app
sudo tee /etc/nginx/sites-available/flowdesk << 'NGINX'
server {
    listen 80;
    server_name tudominio.com;
    location / { proxy_pass http://localhost:3000; proxy_set_header Host $host; }
}
server {
    listen 80;
    server_name api.tudominio.com;
    location / { proxy_pass http://localhost:3001; proxy_set_header Host $host; }
}
NGINX

sudo ln -s /etc/nginx/sites-available/flowdesk /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Obtener certificado SSL
sudo certbot --nginx -d tudominio.com -d api.tudominio.com
\`\`\`

**4.12. Actualizar .env con dominio real**
\`\`\`bash
# Editar .env
nano /opt/flowdesk/.env

# Cambiar estas líneas:
FRONTEND_URL=https://tudominio.com
FRONTEND_API_URL=https://api.tudominio.com/api/v1

# Reiniciar
docker compose restart
\`\`\`

---

### Fase 5 — Post-migración en FlowDesk Cloud

**4.13. Confirmar migración en el panel admin**
En FlowDesk Cloud → Admin → Clientes → ${tenant.name} → **Verificar servidor propio**, ingresa la URL del nuevo servidor y haz clic en verificar. Esto marcará oficialmente la empresa como migrada.

---

## 5. Rotación de claves (post-verificación)

Una vez que todo esté funcionando al 100%, rota las claves sensibles:

### 5.1. Nueva ENCRYPTION_KEY
La \`ENCRYPTION_KEY\` actual es la misma que la de FlowDesk Cloud — eso está bien por diseño, pero después de migrar deberías tener la tuya propia:

\`\`\`bash
# 1. Generar nueva clave
NEW_KEY=$(openssl rand -hex 32)
echo "Nueva clave: $NEW_KEY"

# 2. Actualizar .env
sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$NEW_KEY/" /opt/flowdesk/.env

# 3. Re-cifrar el Vault (el API lo hace al arrancar con la nueva clave)
docker compose exec api npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
// Script de rotación de clave - contactar a soporte@flowdesk.mx
console.log('Contactar soporte para script de rotación completo')
"
\`\`\`

> Para ayuda con la rotación de ENCRYPTION_KEY, contacta a soporte@flowdesk.mx

### 5.2. Nuevo JWT_SECRET
\`\`\`bash
NEW_JWT=$(openssl rand -hex 32)
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$NEW_JWT/" /opt/flowdesk/.env
docker compose restart api
\`\`\`

Esto cerrará todas las sesiones activas — los usuarios deberán volver a iniciar sesión.

### 5.3. Nueva contraseña de PostgreSQL
\`\`\`bash
# 1. Cambiar en PostgreSQL
docker compose exec postgres psql -U flowdesk -c "ALTER USER flowdesk PASSWORD 'nueva_contraseña_segura';"

# 2. Actualizar .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=nueva_contraseña_segura/" /opt/flowdesk/.env
sed -i "s|postgresql://flowdesk:.*@|postgresql://flowdesk:nueva_contraseña_segura@|" /opt/flowdesk/.env

# 3. Reiniciar
docker compose restart api
\`\`\`

---

## 6. Backups automáticos

### Backup de base de datos (recomendado: diario)
\`\`\`bash
# Crear script de backup
sudo tee /opt/flowdesk/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/opt/flowdesk/backups
mkdir -p $BACKUP_DIR

docker compose -f /opt/flowdesk/docker-compose.yml exec -T postgres \\
  pg_dump -U flowdesk flowdesk | gzip > $BACKUP_DIR/flowdesk_$DATE.sql.gz

# Mantener solo los últimos 30 días
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
echo "Backup completado: flowdesk_$DATE.sql.gz"
EOF

chmod +x /opt/flowdesk/backup.sh

# Programar en cron (diario a las 3am)
echo "0 3 * * * /opt/flowdesk/backup.sh >> /var/log/flowdesk-backup.log 2>&1" | crontab -
\`\`\`

---

## 7. Actualizaciones de FlowDesk

Las actualizaciones de software se pueden contratar con MentorIA o aplicar manualmente:

\`\`\`bash
# Descargar nueva imagen
docker compose pull

# Aplicar migraciones de schema (si las hay)
docker compose run --rm api npx prisma migrate deploy

# Reiniciar con nueva versión
docker compose up -d --force-recreate
\`\`\`

---

## 8. Solución de problemas frecuentes

### ❌ "no se puede conectar a la base de datos"
\`\`\`bash
# Verificar que postgres esté corriendo
docker compose ps postgres
# Verificar logs
docker compose logs postgres --tail 20
# Verificar DATABASE_URL en .env
grep DATABASE_URL /opt/flowdesk/.env
\`\`\`

### ❌ "Vault entries no descifran"
El .env incluye la ENCRYPTION_KEY original de FlowDesk Cloud. Si el descifrado falla:
1. Verifica que \`ENCRYPTION_KEY\` en tu .env sea exactamente la que vino en el paquete
2. No debe tener espacios ni comillas adicionales
\`\`\`bash
grep ENCRYPTION_KEY /opt/flowdesk/.env
\`\`\`

### ❌ "Los vectores del Brain no funcionan"
\`\`\`bash
# Verificar pgvector
docker compose exec postgres psql -U flowdesk -d flowdesk -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"

# Si no está instalada:
docker compose exec postgres psql -U flowdesk -d flowdesk -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Re-generar embeddings vacíos
curl -X POST http://localhost:3001/api/v1/brain/reindex \\
  -H "Authorization: Bearer TU_JWT_TOKEN"
\`\`\`

### ⚠️ "Los agentes de IA no responden"
1. Verifica que las API keys (Anthropic/OpenAI) estén correctas en el .env
2. Verifica la conectividad a los proveedores de IA:
\`\`\`bash
curl -s https://api.anthropic.com/v1/messages \\
  -H "x-api-key: $(grep ANTHROPIC_API_KEY /opt/flowdesk/.env | cut -d= -f2)" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
\`\`\`

### ⚠️ "WhatsApp/Atlas no funciona"
1. La instancia Evolution API debe apuntarse a tu nueva URL
2. Actualiza \`EVOLUTION_INSTANCE\` en .env si cambiaste el nombre
3. Contacta a MentorIA para migrar la instancia Evolution a tu servidor

---

## 9. Contacto y soporte

| Canal | Contacto | Disponibilidad |
|-------|---------|----------------|
| Email | soporte@flowdesk.mx | L-V 9:00-18:00 CST |
| WhatsApp | +52 (contacto en onboarding) | L-V 9:00-18:00 CST |
| Urgencias | soporte@mentoria.mx | 24/7 con SLA Enterprise |

---

*FlowDesk es desarrollado por MentorIA · flowdesk.mx*
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
      verify_sh: verifySh,
      install_md: instructions,
      migration_manual: migrationManual,
      data_sql: dataSql,
      export_stats: stats.filter(s => s.count > 0),
      generated_at: new Date().toISOString(),
    };
  }

  // ─── PLATFORM: provisionar nuevo tenant ────────────────────────────────────

  async provisionTenant(callerTenantId: string, dto: {
    name: string; slug: string; tenant_type: 'NETWORK' | 'BRANCH';
    network_id?: string; external_ref?: string; plan?: string; account_type?: string;
    owner_email: string; owner_name: string; modules_config?: any[];
  }) {
    await this.assertPlatform(callerTenantId);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name, slug: dto.slug, tenant_type: dto.tenant_type,
          network_id: dto.network_id ?? null, external_ref: dto.external_ref ?? null,
          plan: dto.plan ?? 'starter', status: 'active',
          ...(dto.account_type && { account_type: dto.account_type }),
          ...(dto.modules_config && { modules_config: dto.modules_config }),
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

  async impersonateTenant(callerTenantId: string, targetTenantId: string, callerName?: string | null, callerEmail?: string | null) {
    await this.assertPlatform(callerTenantId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: targetTenantId },
      select: { id: true, name: true, tenant_type: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    // Busca el slot de mayor privilegio del tenant: owner > admin > cualquier humano
    const slot =
      (await this.prisma.teamSlot.findFirst({
        where: { tenant_id: targetTenantId, type: 'HUMAN', role: 'owner' },
        select: { id: true, email: true, name: true, role: true, type: true },
      })) ??
      (await this.prisma.teamSlot.findFirst({
        where: { tenant_id: targetTenantId, type: 'HUMAN', role: 'admin' },
        select: { id: true, email: true, name: true, role: true, type: true },
      })) ??
      (await this.prisma.teamSlot.findFirst({
        where: { tenant_id: targetTenantId, type: 'HUMAN' },
        select: { id: true, email: true, name: true, role: true, type: true },
      }));

    if (!slot) throw new NotFoundException('No hay usuarios humanos en este tenant');

    // El token usa el slot del tenant destino (para que funcionen sidebar y datos)
    // pero embebe la identidad del super admin para mostrarla en el banner
    const payload = {
      sub: slot.id,
      tenant_id: targetTenantId,
      role: slot.role,
      type: slot.type,
      email: slot.email,
      tenant_type: tenant.tenant_type,
      platform_admin: true,
      impersonator_name: callerName ?? null,
      impersonator_email: callerEmail ?? null,
    };

    const access_token = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: '8h',
    });

    return {
      access_token,
      company_name: tenant.name,
      user: {
        slot_id: slot.id,
        tenant_id: targetTenantId,
        role: slot.role,
        type: slot.type,
        email: slot.email ?? '',
        name: slot.name,
        tenant_type: tenant.tenant_type,
        platform_admin: true,
        impersonator_name: callerName ?? null,
        impersonator_email: callerEmail ?? null,
      },
    };
  }

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

  async createTenantSlot(
    callerTenantId: string,
    targetTenantId: string,
    dto: { name: string; email: string; role?: string; worker_type?: string; password?: string },
  ) {
    await this.assertPlatform(callerTenantId);

    const exists = await this.prisma.teamSlot.findFirst({ where: { email: dto.email } });
    if (exists) throw new ConflictException(`El email ${dto.email} ya está registrado`);

    const tempPassword = dto.password ?? randomBytes(5).toString('hex');
    const hash = await bcrypt.hash(tempPassword, 12);

    const workerType  = (dto.worker_type === 'operative') ? 'operative' : 'desk';
    const deskAccess  = workerType === 'operative' ? 'NONE' : 'FULL';

    const slot = await this.prisma.teamSlot.create({
      data: {
        tenant_id:     targetTenantId,
        name:          dto.name,
        email:         dto.email,
        role:          dto.role ?? 'employee',
        type:          'HUMAN',
        status:        'OFFLINE',
        password_hash: hash,
        desk_access:   deskAccess,
      },
      select: { id: true, name: true, email: true, role: true, tenant_id: true },
    });

    const tenant = await this.prisma.tenant.findUnique({ where: { id: targetTenantId }, select: { name: true } });
    const loginUrl = this.config.get<string>('APP_URL') ?? 'https://app.flowdesk.mx';
    this.email.sendWelcome({
      to:           dto.email,
      name:         dto.name,
      tempPassword,
      tenantName:   tenant?.name ?? 'FlowDesk',
      loginUrl,
    });

    return { ...slot, temp_password: tempPassword };
  }

  async deleteTenantSlot(callerTenantId: string, slotId: string) {
    await this.assertPlatform(callerTenantId);
    const slot = await this.prisma.teamSlot.findUnique({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`Usuario ${slotId} no encontrado`);
    await this.prisma.teamSlot.delete({ where: { id: slotId } });
    return { message: `${slot.name} eliminado` };
  }
}
