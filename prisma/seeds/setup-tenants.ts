/**
 * Seed: Setup inicial de tenants para FlowDesk
 *
 * Crea:
 *   1. Actualiza el tenant PLATFORM (FlowDesk) con identidad completa
 *   2. MentorIA Systems (NETWORK) — la empresa que usa FlowDesk
 *   3. Partnerships (NETWORK) — los socios de MentorIA
 *
 * Uso:
 *   DATABASE_URL=<railway_url> npx ts-node prisma/seeds/setup-tenants.ts
 *
 * El script es idempotente — usa upsert por slug.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Datos de los tenants ────────────────────────────────────────────────────

const PLATFORM_TENANT_SLUG = 'flowdesk'; // ya existe

const MENTORIA = {
  name:     'MentorIA Systems',
  slug:     'mentoria',
  tagline:  'inteligencia humana, potencia artificial',
  industry: 'Tecnología — Agentes de Inteligencia Artificial',
  mission:  'Dar a los negocios latinoamericanos acceso a departamentos completos de IA que trabajen junto a sus equipos humanos',
  vision:   'Ser la infraestructura de agentes de IA más usada por las PYMEs de Latinoamérica',
  website:  'https://mentoriasystems.com',
  primary_color:   '#4DBBF0',
  secondary_color: '#1A7FDB',
  plan:        'enterprise',
  tenant_type: 'NETWORK',
  owner_name:  'Manolo Hernandez',
  owner_email: 'manolo@mentoriasystems.com',
  owner_pass:  'MentorIA2026!',
};

// Partnerships de MentorIA — equipos de ventas de desarrollo inmobiliario
const PARTNERSHIPS: Array<{
  name: string; slug: string; industry: string; owner_name: string; owner_email: string; owner_pass: string;
}> = [
  {
    name: 'Nodo',
    slug: 'nodo',
    industry: 'Inmobiliario — Ventas de Desarrollo',
    owner_name: 'Equipo Nodo',
    owner_email: 'admin@nodo.com.mx',
    owner_pass: 'Nodo2026!',
  },
  {
    name: 'Residencial San Miguel',
    slug: 'rsm',
    industry: 'Inmobiliario — Ventas de Desarrollo',
    owner_name: 'Equipo Residencial San Miguel',
    owner_email: 'admin@rsm.com.mx',
    owner_pass: 'RSM2026!',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureNetworkTenant(config: {
  name: string; slug: string; tagline?: string; industry?: string; [key: string]: any;
  mission?: string; vision?: string; website?: string;
  primary_color?: string; secondary_color?: string; plan?: string; tenant_type?: string;
  network_id: string;
  owner_name: string; owner_email: string; owner_pass: string;
}): Promise<{ tenant_id: string; owner_slot_id: string; created: boolean }> {
  const existing = await prisma.tenant.findUnique({ where: { slug: config.slug } });

  let tenantId: string;
  let ownerSlotId: string;
  let created = false;

  if (existing) {
    console.log(`  → Tenant "${config.slug}" ya existe (${existing.id}), actualizando...`);
    await prisma.tenant.update({
      where: { id: existing.id },
      data: {
        name: config.name, tagline: config.tagline, industry: config.industry,
        mission: config.mission, vision: config.vision, website: config.website,
        primary_color: config.primary_color, secondary_color: config.secondary_color,
        network_id: config.network_id,
      },
    });
    tenantId = existing.id;

    const ownerSlot = await prisma.teamSlot.findFirst({ where: { tenant_id: tenantId, role: 'owner' } });
    ownerSlotId = ownerSlot?.id ?? '';
  } else {
    console.log(`  → Creando tenant "${config.slug}"...`);
    const tenant = await prisma.tenant.create({
      data: {
        name: config.name, slug: config.slug, tagline: config.tagline, industry: config.industry,
        mission: config.mission, vision: config.vision, website: config.website,
        primary_color: config.primary_color ?? '#4F46E5',
        secondary_color: config.secondary_color,
        plan: config.plan ?? 'starter', status: 'active',
        tenant_type: config.tenant_type ?? 'NETWORK',
        network_id: config.network_id,
      },
    });
    tenantId = tenant.id;

    const hash = await bcrypt.hash(config.owner_pass, 10);
    const ownerSlot = await prisma.teamSlot.create({
      data: {
        tenant_id: tenantId,
        name: config.owner_name, email: config.owner_email, password_hash: hash,
        type: 'HUMAN', role: 'owner', status: 'OFFLINE', desk_access: 'FULL',
      },
    });
    ownerSlotId = ownerSlot.id;

    // Atlas personal para el owner
    await prisma.teamSlot.create({
      data: {
        tenant_id: tenantId,
        name: 'Atlas', type: 'AI_AGENT', role: 'employee', status: 'ONLINE',
        agent_role: 'ceo', agent_scope: 'personal', owner_slot_id: ownerSlotId,
        agent_config: {
          model: 'claude-sonnet-4-6',
          instructions: `Soy Atlas, Secretario Personal de ${config.owner_name} en ${config.name}.`,
          tools: [],
        },
      },
    });

    created = true;
    console.log(`    ✅ Tenant creado: ${tenantId}`);
    console.log(`    ✅ Owner: ${config.owner_email} / ${config.owner_pass}`);
  }

  return { tenant_id: tenantId, owner_slot_id: ownerSlotId, created };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 Setup inicial de tenants FlowDesk\n');

  // 1. Obtener el PLATFORM tenant
  const platform = await prisma.tenant.findUnique({ where: { slug: PLATFORM_TENANT_SLUG } });
  if (!platform) {
    console.error(`❌ No se encontró el PLATFORM tenant con slug "${PLATFORM_TENANT_SLUG}"`);
    process.exit(1);
  }
  console.log(`✅ PLATFORM: ${platform.name} (${platform.id})`);

  // 2. Actualizar PLATFORM con identidad completa
  await prisma.tenant.update({
    where: { id: platform.id },
    data: {
      tagline:  'El sistema operativo para equipos híbridos humano-IA',
      mission:  'Darle a cada empresa la infraestructura de IA que antes solo tenían las grandes corporaciones',
      vision:   'Ser el sistema operativo de cada PYME latinoamericana en 2030',
      website:  'https://flowdesk.mx',
      industry: 'SaaS — Tecnología de Inteligencia Artificial',
      secondary_color: '#7C3AED',
    },
  });
  console.log('✅ PLATFORM identity actualizado\n');

  // 3. Crear MentorIA Systems
  console.log('📌 Creando MentorIA Systems...');
  const mentoria = await ensureNetworkTenant({ ...MENTORIA, network_id: platform.id });
  console.log();

  // 4. Crear Partnerships
  if (PARTNERSHIPS.length > 0) {
    console.log('📌 Creando partnerships...');
    for (const partner of PARTNERSHIPS) {
      await ensureNetworkTenant({
        ...partner,
        plan: 'professional',
        tenant_type: 'NETWORK',
        network_id: platform.id,
        primary_color: '#0EA5E9',
        secondary_color: '#0369A1',
      });
    }
    console.log();
  } else {
    console.log('ℹ️  Sin partnerships configurados. Editar PARTNERSHIPS[] en este archivo para añadirlos.\n');
  }

  // 5. Resumen final
  const allTenants = await prisma.tenant.findMany({
    where: { tenant_type: { in: ['NETWORK', 'PLATFORM'] } },
    select: { name: true, slug: true, tenant_type: true, plan: true },
    orderBy: { created_at: 'asc' },
  });

  console.log('═══════════════════════════════════════');
  console.log('📊 Estado final de la red:');
  for (const t of allTenants) {
    console.log(`  [${t.tenant_type}] ${t.name} (${t.slug}) — ${t.plan}`);
  }
  console.log('═══════════════════════════════════════\n');
  console.log('✅ Setup completado.\n');
}

main()
  .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
