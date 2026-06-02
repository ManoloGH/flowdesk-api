/**
 * Seed: Setup inicial de cuentas FlowDesk — Arquitectura v2
 *
 * Crea las cuentas de negocio bajo el super admin de FlowDesk:
 *
 *   PLATFORM (super admin técnico): flowdesk — ya existe
 *   ├── NETWORK: flowdesk-empresa   — FlowDesk como empresa SaaS (solo agentes IA)
 *   ├── NETWORK: mentoria-systems   — MentorIA Systems (2 ramas operativas)
 *   ├── NETWORK: nodo               — Partnership inmobiliario
 *   ├── NETWORK: rsm                — Partnership inmobiliario
 *   └── NETWORK: ensenanza          — Partnership educativo (esqueleto)
 *
 * Uso:
 *   DATABASE_URL=<railway_url> npx ts-node prisma/seeds/setup-tenants.ts
 *
 * Idempotente — usa upsert por slug.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── IDs del PLATFORM (ya existe en producción) ────────────────────────────────
const PLATFORM_SLUG = 'flowdesk';

// ─── Definición de cuentas ─────────────────────────────────────────────────────

const ACCOUNTS = [

  // ── FlowDesk como empresa SaaS (sin humanos, solo agentes) ──────────────────
  {
    slug:           'flowdesk-empresa',
    name:           'FlowDesk',
    tagline:        'El sistema operativo para equipos híbridos humano-IA',
    industry:       'SaaS — Tecnología de Inteligencia Artificial',
    mission:        'Darle a cada empresa la infraestructura de IA que antes solo tenían las grandes corporaciones',
    vision:         'Ser el sistema operativo de cada PYME latinoamericana en 2030',
    website:        'https://flowdesk.mx',
    primary_color:  '#4F46E5',
    secondary_color:'#7C3AED',
    plan:           'internal',
    account_type:   'SAAS_ACCOUNT',
    // Sin owner humano — la operan agentes IA
    owner_email:    null as null,
    owner_name:     null as null,
    agents: [
      {
        name:       'Atlas CEO',
        agent_role: 'ceo',
        agent_scope:'company',
        instructions: 'Soy el CEO Agent de FlowDesk. Coordino todos los agentes de la empresa y mantengo el foco en el objetivo: más usuarios activos que se transformen en empresas IA-first.',
      },
      {
        name:       'Agente de Crecimiento',
        agent_role: 'growth',
        agent_scope:'company',
        instructions: 'Soy el Agente de Crecimiento de FlowDesk. Monitoreo tenants activos, detecto oportunidades de expansión y propongo acciones para crecer la base de usuarios.',
      },
      {
        name:       'Agente de Soporte',
        agent_role: 'support',
        agent_scope:'company',
        instructions: 'Soy el Agente de Soporte de FlowDesk. Respondo dudas técnicas, documento problemas recurrentes y escalo incidencias críticas.',
      },
    ],
    departments: [
      { name: 'Producto',     color: '#4F46E5', dept_type: 'product' },
      { name: 'Crecimiento',  color: '#7C3AED', dept_type: 'growth' },
      { name: 'Soporte',      color: '#0EA5E9', dept_type: 'support' },
    ],
    campus_config: {
      account_type:   'SAAS_ACCOUNT',
      kpis_focus:     ['tenants_activos', 'focus_mode_adoption', 'nps', 'churn_rate'],
      description:    'Empresa SaaS operada 100% por agentes IA. Sin empleados humanos.',
    },
  },

  // ── MentorIA Systems (2 ramas operativas) ──────────────────────────────────
  {
    slug:           'mentoria',
    name:           'MentorIA Systems',
    tagline:        'inteligencia humana, potencia artificial',
    industry:       'Tecnología — Consultoría e Implementación de IA',
    mission:        'Dar a las PYMEs latinoamericanas acceso a departamentos completos de IA que trabajen junto a sus equipos humanos',
    vision:         'Ser la empresa de referencia en implementación de IA para PYMEs latinoamericanas en 2028',
    website:        'https://mentoriasystems.com',
    primary_color:  '#4DBBF0',
    secondary_color:'#1A7FDB',
    plan:           'enterprise',
    account_type:   'SAAS_ACCOUNT',
    owner_email:    'manolo@mentoriasystems.com',
    owner_name:     'Manolo Hernandez',
    agents: [
      {
        name:       'Atlas — Secretario Personal',
        agent_role: 'personal_secretary',
        agent_scope:'personal',
        instructions: 'Soy Atlas, Secretario Personal del Founder de MentorIA Systems. Coordino el día a día, mantengo el foco en los objetivos de las dos ramas del negocio y gestiono la relación con clientes y partnerships.',
      },
      {
        name:       'Agente de Consultoría',
        agent_role: 'consulting',
        agent_scope:'department',
        instructions: 'Soy el Agente de Consultoría de MentorIA. Coordino proyectos de diagnóstico e implementación de IA para clientes. Hago seguimiento de cada proyecto y alerto cuando hay riesgos.',
      },
      {
        name:       'Agente de Partnerships',
        agent_role: 'partnerships',
        agent_scope:'department',
        instructions: 'Soy el Agente de Partnerships de MentorIA. Monitoreo los KSFs de cada empresa partnership, coordino las operaciones que MentorIA ejecuta por ellos y reporto resultados mensualmente.',
      },
    ],
    departments: [
      { name: 'Consultoría IA',  color: '#4DBBF0', dept_type: 'consulting' },
      { name: 'Partnerships',    color: '#7C3AED', dept_type: 'partnerships' },
      { name: 'Operaciones',     color: '#10B981', dept_type: 'ops' },
    ],
    campus_config: {
      account_type:     'SAAS_ACCOUNT',
      rama_consultoria: {
        descripcion:    'Clientes de consultoría — proyectos de diagnóstico e implementación de IA',
        entrada:        'diagnóstico_inicial',
        implementacion: ['consultoria_equipo', 'agentes_especificos', 'ecosistema_flowdesk'],
        comunicacion:   'centrada_en_diagnostico',
      },
      rama_partnerships: {
        descripcion:    'Negocios donde MentorIA opera y tiene participación',
        modelo:         'mentoria_opera_por_ellos_a_cambio_de_porcentaje',
        partnerships:   ['flowdesk', 'nodo', 'rsm', 'ensenanza'],
      },
      kpis_focus: [
        'clientes_consultoria_activos',
        'revenue_consultoria',
        'salud_partnerships',
        'nuevos_partnerships',
      ],
    },
  },

  // ── Nodo (partnership inmobiliario) ────────────────────────────────────────
  {
    slug:           'nodo',
    name:           'Nodo',
    tagline:        'Ventas de desarrollo inmobiliario',
    industry:       'Inmobiliario — Ventas de Desarrollo',
    mission:        'Cerrar más ventas inmobiliarias con procesos más eficientes',
    vision:         'Ser el equipo de ventas inmobiliarias más productivo de la región',
    website:        null as null,
    primary_color:  '#0EA5E9',
    secondary_color:'#0369A1',
    plan:           'professional',
    account_type:   'PARTNERSHIP',
    owner_email:    'admin@nodo.com.mx',
    owner_name:     'Equipo Nodo',
    agents: [
      {
        name:       'Atlas — Secretario Ventas',
        agent_role: 'personal_secretary',
        agent_scope:'company',
        instructions: 'Soy Atlas, el Secretario del equipo de ventas de Nodo. Coordino el pipeline de prospectos, hago seguimiento de oportunidades y preparo el Daily Brief de ventas cada mañana.',
      },
    ],
    departments: [
      { name: 'Ventas',        color: '#0EA5E9', dept_type: 'sales' },
      { name: 'Prospección',   color: '#7C3AED', dept_type: 'prospecting' },
      { name: 'Administración',color: '#6B7280', dept_type: 'admin' },
    ],
    campus_config: {
      account_type:   'PARTNERSHIP',
      sector:         'inmobiliario',
      sub_sector:     'ventas_desarrollo',
      mentoria_role:  'operador_con_participacion',
      kpis_focus:     ['prospectos_contactados', 'citas_agendadas', 'cierres_mes', 'ticket_promedio'],
    },
  },

  // ── Residencial San Miguel (partnership inmobiliario) ──────────────────────
  {
    slug:           'rsm',
    name:           'Residencial San Miguel',
    tagline:        'Ventas de desarrollo inmobiliario',
    industry:       'Inmobiliario — Ventas de Desarrollo',
    mission:        'Conectar familias con su hogar ideal a través de procesos de venta eficientes',
    vision:         'Ser referencia en ventas inmobiliarias en la zona',
    website:        null as null,
    primary_color:  '#0EA5E9',
    secondary_color:'#0369A1',
    plan:           'professional',
    account_type:   'PARTNERSHIP',
    owner_email:    'admin@rsm.com.mx',
    owner_name:     'Equipo Residencial San Miguel',
    agents: [
      {
        name:       'Atlas — Secretario Ventas',
        agent_role: 'personal_secretary',
        agent_scope:'company',
        instructions: 'Soy Atlas, el Secretario del equipo de ventas de Residencial San Miguel. Coordino el pipeline de prospectos y el seguimiento de oportunidades inmobiliarias.',
      },
    ],
    departments: [
      { name: 'Ventas',        color: '#0EA5E9', dept_type: 'sales' },
      { name: 'Prospección',   color: '#7C3AED', dept_type: 'prospecting' },
      { name: 'Administración',color: '#6B7280', dept_type: 'admin' },
    ],
    campus_config: {
      account_type:   'PARTNERSHIP',
      sector:         'inmobiliario',
      sub_sector:     'ventas_desarrollo',
      mentoria_role:  'operador_con_participacion',
      kpis_focus:     ['prospectos_contactados', 'citas_agendadas', 'cierres_mes', 'ticket_promedio'],
    },
  },

  // ── Enseñanza (partnership educativo — esqueleto) ──────────────────────────
  {
    slug:           'ensenanza',
    name:           'Enseñanza MentorIA',
    tagline:        'Formación en inteligencia artificial práctica',
    industry:       'Educación — Formación en IA',
    mission:        'Enseñar a empresas y personas a trabajar con IA en su día a día',
    vision:         'Ser la escuela de IA más práctica de Latinoamérica',
    website:        null as null,
    primary_color:  '#8B5CF6',
    secondary_color:'#6D28D9',
    plan:           'starter',
    account_type:   'PARTNERSHIP',
    owner_email:    'admin@ensenanza.mentoriasystems.com',
    owner_name:     'Equipo Enseñanza',
    agents: [
      {
        name:       'Atlas — Secretario Educación',
        agent_role: 'personal_secretary',
        agent_scope:'company',
        instructions: 'Soy Atlas, el Secretario del programa de Enseñanza de MentorIA. Coordino cursos, alumnos y el calendario de formación.',
      },
    ],
    departments: [
      { name: 'Cursos',         color: '#8B5CF6', dept_type: 'education' },
      { name: 'Comunidad',      color: '#EC4899', dept_type: 'community' },
      { name: 'Administración', color: '#6B7280', dept_type: 'admin' },
    ],
    campus_config: {
      account_type:   'PARTNERSHIP',
      sector:         'educacion',
      sub_sector:     'formacion_ia',
      mentoria_role:  'operador_con_participacion',
      status_note:    'esqueleto_activo_pendiente_configuracion_completa',
      kpis_focus:     ['alumnos_activos', 'cursos_completados', 'revenue_educacion', 'nps_alumnos'],
    },
  },

] as const;

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function upsertAccount(
  config: typeof ACCOUNTS[number],
  platformId: string,
) {
  const existing = await prisma.tenant.findUnique({ where: { slug: config.slug } });

  let tenantId: string;

  if (existing) {
    console.log(`  → "${config.slug}" existe (${existing.id}) — actualizando identidad...`);
    await prisma.tenant.update({
      where: { id: existing.id },
      data: {
        name:            config.name,
        tagline:         config.tagline,
        industry:        config.industry,
        mission:         config.mission,
        vision:          config.vision,
        website:         config.website ?? undefined,
        primary_color:   config.primary_color,
        secondary_color: config.secondary_color,
        network_id:      platformId,
        campus_config:   config.campus_config as any,
      },
    });
    tenantId = existing.id;
  } else {
    console.log(`  → Creando "${config.slug}"...`);
    const tenant = await prisma.tenant.create({
      data: {
        name:            config.name,
        slug:            config.slug,
        tagline:         config.tagline ?? undefined,
        industry:        config.industry,
        mission:         config.mission,
        vision:          config.vision,
        website:         config.website ?? undefined,
        primary_color:   config.primary_color,
        secondary_color: config.secondary_color,
        plan:            config.plan,
        status:          'active',
        tenant_type:     'NETWORK',
        network_id:      platformId,
        campus_config:   config.campus_config as any,
      },
    });
    tenantId = tenant.id;
    console.log(`    ✅ Tenant: ${tenantId}`);
  }

  // Owner humano (si aplica)
  if (config.owner_email) {
    const existingOwner = await prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
    });
    if (!existingOwner) {
      const hash = await bcrypt.hash('1234567890', 10);
      await prisma.teamSlot.create({
        data: {
          tenant_id:     tenantId,
          name:          config.owner_name!,
          email:         config.owner_email,
          password_hash: hash,
          type:          'HUMAN',
          role:          'owner',
          status:        'OFFLINE',
          desk_access:   'FULL',
        },
      });
      console.log(`    ✅ Owner: ${config.owner_email}`);
    }
  }

  // Departamentos
  const existingDepts = await prisma.department.findMany({ where: { tenant_id: tenantId } });
  if (existingDepts.length === 0 && config.departments.length > 0) {
    for (const dept of config.departments) {
      await prisma.department.create({
        data: {
          tenant_id:  tenantId,
          name:       dept.name,
          color:      dept.color,
          dept_type:  dept.dept_type,
        },
      });
    }
    console.log(`    ✅ Departamentos: ${config.departments.map(d => d.name).join(', ')}`);
  }

  // Agentes IA
  const existingAgents = await prisma.teamSlot.findMany({
    where: { tenant_id: tenantId, type: 'AI_AGENT' },
  });

  for (const agentDef of config.agents) {
    const exists = existingAgents.find(a => a.name === agentDef.name);
    if (!exists) {
      // Para FlowDesk empresa (sin owner humano), el owner es null
      const ownerSlot = await prisma.teamSlot.findFirst({
        where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
      });

      await prisma.teamSlot.create({
        data: {
          tenant_id:     tenantId,
          name:          agentDef.name,
          type:          'AI_AGENT',
          role:          'employee',
          status:        'ONLINE',
          agent_role:    agentDef.agent_role,
          agent_scope:   agentDef.agent_scope,
          owner_slot_id: ownerSlot?.id ?? undefined,
          agent_config: {
            model:        'claude-sonnet-4-6',
            instructions: agentDef.instructions,
            tools:        [],
          },
        },
      });
    }
  }
  console.log(`    ✅ Agentes: ${config.agents.map(a => a.name).join(', ')}`);

  return { tenant_id: tenantId };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 FlowDesk — Setup de cuentas v2 (Arquitectura MentorIA + Partnerships)\n');

  // 1. Obtener el PLATFORM (super admin técnico)
  const platform = await prisma.tenant.findUnique({ where: { slug: PLATFORM_SLUG } });
  if (!platform) {
    console.error(`❌ No se encontró el PLATFORM tenant con slug "${PLATFORM_SLUG}"`);
    console.error('   Crea el tenant de FlowDesk primero con el seed original o via login en flowdesk.mx');
    process.exit(1);
  }
  console.log(`✅ PLATFORM: ${platform.name} (${platform.id})\n`);

  // 2. Actualizar identidad del PLATFORM
  await prisma.tenant.update({
    where: { id: platform.id },
    data: {
      tagline:         'El sistema operativo para equipos híbridos humano-IA',
      mission:         'Darle a cada empresa la infraestructura de IA que antes solo tenían las grandes corporaciones',
      vision:          'Ser el sistema operativo de cada PYME latinoamericana en 2030',
      website:         'https://flowdesk.mx',
      industry:        'SaaS — Tecnología de Inteligencia Artificial',
      secondary_color: '#7C3AED',
    },
  });
  console.log('✅ PLATFORM identity actualizado\n');

  // 3. Crear / actualizar todas las cuentas
  const results: Record<string, string> = {};
  for (const account of ACCOUNTS) {
    console.log(`📌 ${account.name} [${account.account_type}]`);
    const { tenant_id } = await upsertAccount(account as any, platform.id);
    results[account.slug] = tenant_id;
    console.log();
  }

  // 4. Resumen
  const allNetwork = await prisma.tenant.findMany({
    where: { network_id: platform.id },
    select: { name: true, slug: true, plan: true, tenant_type: true, campus_config: true },
    orderBy: { created_at: 'asc' },
  });

  console.log('═══════════════════════════════════════════════════════');
  console.log(`📊 Red FlowDesk — ${allNetwork.length} cuentas:`);
  for (const t of allNetwork) {
    const cfg = (t.campus_config as any) ?? {};
    const type = cfg.account_type ?? 'company';
    console.log(`  [${type.padEnd(20)}] ${t.name.padEnd(30)} ${t.plan}`);
  }
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('✅ Setup v2 completado.\n');
  console.log('Accesos iniciales (contraseña: 1234567890):');
  for (const account of ACCOUNTS) {
    if (account.owner_email) {
      console.log(`  ${account.name.padEnd(30)} ${account.owner_email}`);
    }
  }
  console.log();
}

main()
  .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
