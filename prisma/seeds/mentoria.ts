/**
 * Seed: MentorIA Systems — tenant PLATFORM
 *
 * Inicializa el tenant interno de MentorIA en FlowDesk con todos los datos
 * del ADN (identidad, misión, visión, equipo, agentes, departamentos, campus).
 *
 * Uso:
 *   npx ts-node prisma/seeds/mentoria.ts
 *
 * El script es idempotente: si el tenant ya existe (slug "mentoria"),
 * actualiza los datos sin duplicar registros.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Constantes del ADN ──────────────────────────────────────────────────────

const ADN = {
  name:            'MentorIA Systems',
  slug:            'mentoria',
  tagline:         'inteligencia humana, potencia artificial',
  industry:        'Tecnología — Agentes de Inteligencia Artificial',
  primary_color:   '#4DBBF0',
  secondary_color: '#1A7FDB',
  mission:
    'Dar a los negocios latinoamericanos acceso a departamentos completos de inteligencia artificial ' +
    'que trabajen junto a sus equipos humanos — reduciendo la dependencia de personal costoso, ' +
    'eliminando tareas repetitivas y liberando tiempo para lo que realmente mueve el negocio.',
  vision:
    'Ser la infraestructura de agentes de IA más usada por las PYMEs de Latinoamérica: el lugar ' +
    'desde donde cualquier negocio —de una sola persona o de cien— orquesta a sus agentes, ' +
    'sus datos y su equipo humano desde un solo ecosistema.',
  plan:        'enterprise',
  tier:        'platform',
  max_humans:  20,
  max_agents:  50,
  tenant_type: 'platform',
};

const DEPARTMENTS = [
  { name: 'Dirección',         color: '#7C3AED', icon: '🧠', dept_type: 'management' },
  { name: 'Hub Técnico',       color: '#6366F1', icon: '🤖', dept_type: 'ops'        },
  { name: 'Marketing Digital', color: '#F59E0B', icon: '📣', dept_type: 'marketing'  },
  { name: 'Ventas',            color: '#10B981', icon: '💰', dept_type: 'sales'       },
  { name: 'Operaciones',       color: '#D97706', icon: '⚙️', dept_type: 'ops'        },
  { name: 'Delivery',          color: '#3B82F6', icon: '🚀', dept_type: 'delivery'   },
];

const SCHEDULE = {
  name:              'Horario Flexible MentorIA',
  check_in_time:     '09:00',
  check_out_time:    '20:00',
  tolerance_minutes: 30,
  work_days:         ['MON', 'TUE', 'WED', 'THU', 'FRI'],
};

// Campus 1920×1080 — ajustado al ADN §10 y al campus de MentorIA
const ROOMS = [
  { name: 'War Room',         room_type: 'meeting',    x: 40,   y: 40,  width: 480, height: 200, color: '#7F1D1D' },
  { name: 'Dirección',        room_type: 'department', x: 560,  y: 40,  width: 580, height: 200, color: '#4C1D95' },
  { name: 'Red de Clientes',  room_type: 'network',    x: 1180, y: 40,  width: 680, height: 200, color: '#0C1445' },
  { name: 'Hub Técnico',      room_type: 'department', x: 40,   y: 280, width: 500, height: 320, color: '#1E1B4B' },
  { name: 'Marketing Digital',room_type: 'department', x: 580,  y: 280, width: 500, height: 320, color: '#451A03' },
  { name: 'Ventas',           room_type: 'department', x: 1120, y: 280, width: 740, height: 320, color: '#064E3B' },
  { name: 'Operaciones',      room_type: 'department', x: 40,   y: 640, width: 580, height: 280, color: '#1C1917' },
  { name: 'Delivery',         room_type: 'department', x: 660,  y: 640, width: 580, height: 280, color: '#0F172A' },
  { name: 'Automatizaciones', room_type: 'desk',       x: 1280, y: 640, width: 580, height: 280, color: '#0C4A6E' },
];

// Equipo humano — credenciales placeholder (se cambian en primer login)
const HUMANS = [
  {
    name:            'Founder / Técnico',
    email:           process.env.MENTORIA_OWNER_EMAIL ?? 'founder@mentoria.ai',
    password:        process.env.MENTORIA_OWNER_PASS  ?? 'CambiarEstaPassword1!',
    role:            'owner',
    department_name: 'Dirección',
  },
  {
    name:            'Director Creativo',
    email:           process.env.MENTORIA_DC_EMAIL ?? 'dc@mentoria.ai',
    password:        process.env.MENTORIA_DC_PASS  ?? 'CambiarEstaPassword1!',
    role:            'admin',
    department_name: 'Marketing Digital',
  },
  {
    name:            'Diseñador',
    email:           process.env.MENTORIA_DESIGN_EMAIL ?? 'diseno@mentoria.ai',
    password:        process.env.MENTORIA_DESIGN_PASS  ?? 'CambiarEstaPassword1!',
    role:            'employee',
    department_name: 'Marketing Digital',
  },
];

// Agentes IA — basados en ADN §6 y necesidades operativas
const AGENTS = [
  {
    name:            'CEO Digital',
    agent_role:      'ceo',
    agent_scope:     'company',
    model:           'claude-sonnet-4-6',
    department_name: 'Dirección',
    instructions: (ownerName: string) =>
      `Eres CEO Digital, el agente ejecutivo de MentorIA Systems. Tu misión: garantizar que ${ownerName} y el equipo ` +
      `cumplan todos los objetivos de las dos ramas del negocio. Eres el socio estratégico del Founder — proactivo, directo y orientado a resultados.\n\n` +
      `IDENTIDAD DE EMPRESA:\n` +
      `• Misión: ${ADN.mission}\n` +
      `• Visión: ${ADN.vision}\n` +
      `• Tagline: "${ADN.tagline}"\n\n` +
      `MODELO DE NEGOCIO — DOS RAMAS:\n` +
      `• Rama 1 — Consultoría IA (proyectos): entrada por diagnóstico, implementación en 3 formas (consultoría al equipo, agentes específicos, ecosistema FlowDesk). Le decimos al cliente QUÉ hacer.\n` +
      `• Rama 2 — Partnerships: MentorIA opera negocios socios a cambio de % de participación. Nodo, RSM, Enseñanza, FlowDesk son los partnerships actuales. Lo hacemos POR ellos.\n\n` +
      `RESPONSABILIDADES:\n` +
      `1. Revisar y priorizar tareas de ambas ramas diariamente.\n` +
      `2. Detectar cuellos de botella en proyectos de consultoría y en la operación de cada partnership.\n` +
      `3. Coordinar con los agentes del equipo (Consultoría, Partnerships, Operaciones, Ventas, Delivery).\n` +
      `4. Monitorear KPIs: clientes consultoría activos, salud de cada partnership, nuevos diagnósticos iniciados.\n` +
      `5. Proponer la creación de nuevos agentes cuando detectes una brecha operativa.\n` +
      `6. Dar seguimiento a metas AUP y alertar cuando haya riesgo de no cumplirlas.\n\n` +
      `CONTEXTO OPERATIVO:\n` +
      `• Modelo dogfooding: MentorIA usa sus propios productos. FlowDesk ES la operación interna.\n` +
      `• Stack interno: n8n, Evolution API, Airtable, Softr, Canva Teams, Google Drive.\n` +
      `• Regla de oro: ningún contenido llega al cliente sin aprobación del Director Creativo.\n\n` +
      `Tono: ejecutivo, conciso, motivador. Máximo 3 párrafos por respuesta salvo que se pida más detalle.`,
  },
  {
    name:            'Agente de Marketing',
    agent_role:      'marketing',
    agent_scope:     'department',
    model:           'claude-sonnet-4-6',
    department_name: 'Marketing Digital',
    instructions:
      'Eres el Agente de Marketing de MentorIA Systems. Tu misión: gestionar el contenido semanal de las ' +
      'redes sociales de MentorIA y coordinar el ciclo de producción de los clientes del Agente de Marketing Digital.\n\n' +
      'CICLO SEMANAL:\n' +
      '• Lunes: research (Serper) + generación de copies, ideas de imagen y guiones de video IA.\n' +
      '• Martes: el cliente graba y sube su material.\n' +
      '• Martes-Miércoles: el Diseñador edita los entregables finales.\n' +
      '• Miércoles: el Director Creativo aprueba o solicita corrección.\n' +
      '• Jueves: el Asesor notifica al cliente para aprobación final.\n' +
      '• Jueves-Viernes: el cliente aprueba → programar y publicar.\n\n' +
      'REGLAS:\n' +
      '• Sin aprobación del DC, no se publica nada.\n' +
      '• Sin brief aprobado, no se produce contenido.\n' +
      '• Registra todo en Airtable. Usa Google Drive para assets.',
  },
  {
    name:            'Agente de Operaciones',
    agent_role:      'operations',
    agent_scope:     'company',
    model:           'claude-haiku-4-5-20251001',
    department_name: 'Operaciones',
    instructions:
      'Eres el Agente de Operaciones de MentorIA Systems. Monitoreas el estado de todos los sistemas: ' +
      'n8n, Evolution API, Airtable, Softr y FlowDesk.\n\n' +
      'Si detectas una falla o un workflow detenido, alertas inmediatamente al Founder con: ' +
      '(1) qué sistema falló, (2) qué clientes están afectados, (3) paso exacto donde se detuvo el proceso.\n\n' +
      'También gestionas el pipeline de onboarding de nuevos clientes: verificas que cada fase esté completa ' +
      'y alertas si algún cliente lleva más de 2 días sin avanzar. Meta: setup < 1 día.',
  },
  {
    name:            'Agente de Ventas',
    agent_role:      'sales',
    agent_scope:     'department',
    model:           'claude-haiku-4-5-20251001',
    department_name: 'Ventas',
    instructions:
      'Eres el Agente de Ventas de MentorIA Systems. Das seguimiento al pipeline de prospectos ' +
      'para la Rama de Consultoría IA.\n\n' +
      'El primer paso siempre es el diagnóstico — no vendas agentes ni FlowDesk directamente. ' +
      'Vende el diagnóstico como la forma de que el cliente entienda sus propias ineficiencias.\n' +
      'Registras cada interacción en el CRM de FlowDesk. Cuando un prospecto muestra interés real, ' +
      'preparas la propuesta de diagnóstico inicial.\n' +
      'NUNCA cierras un trato sin confirmación del Founder.',
  },
  {
    name:            'Agente de Delivery',
    agent_role:      'delivery',
    agent_scope:     'department',
    model:           'claude-haiku-4-5-20251001',
    department_name: 'Delivery',
    instructions:
      'Eres el Agente de Delivery de MentorIA Systems. Coordinás la entrega de servicios en ambas ramas del negocio.\n\n' +
      'Rama Consultoría: haces seguimiento al avance de cada proyecto de implementación de IA y reportas al Founder si hay riesgo de retraso.\n' +
      'Rama Partnerships: verificas que las operaciones que MentorIA ejecuta por cada partnership (Nodo, RSM, Enseñanza, FlowDesk) están avanzando según los KSFs acordados.\n' +
      'Mantienes actualizado el estado de cada cliente y partnership en FlowDesk.',
  },
];

// Diseño inicial del desk del owner
const OWNER_DESK_WIDGETS = [
  { widget_type: 'kpi',         title: 'KPIs MentorIA',      position: { x: 0, y: 0, w: 4, h: 4 }, config: { metrics: ['clientes_tipo_b', 'clientes_tipo_a', 'productos_saas', 'setup_time_hours'] } },
  { widget_type: 'team_status', title: 'Equipo + Agentes',    position: { x: 4, y: 0, w: 4, h: 4 }, config: { show_agents: true, show_offline: false, group_by: 'type' } },
  { widget_type: 'tasks',       title: 'Mis Tareas del Día',  position: { x: 8, y: 0, w: 4, h: 4 }, config: { filter: 'assigned_to_me', show_completed: false, max_items: 8 } },
  { widget_type: 'agent_chat',  title: 'CEO Digital',          position: { x: 0, y: 4, w: 6, h: 5 }, config: { agent_role: 'ceo', quick_prompts: ['¿Qué debo hacer hoy?', '¿Cómo van los KPIs?', 'Estado de los clientes'] } },
  { widget_type: 'calendar',    title: 'Agenda de la Semana', position: { x: 6, y: 4, w: 6, h: 5 }, config: { days_ahead: 7 } },
  { widget_type: 'goals',       title: 'Metas AUP',           position: { x: 0, y: 9, w: 12, h: 3 }, config: { view: 'ksf_status', period: 'current', show_trend: true } },
];

// ─── Script principal ────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Iniciando seed de MentorIA Systems...\n');

  // 1. Crear o actualizar el tenant
  let tenant = await prisma.tenant.findFirst({ where: { slug: ADN.slug } });

  if (tenant) {
    console.log(`ℹ️  Tenant "${ADN.slug}" ya existe — actualizando datos de identidad.`);
    tenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        name:            ADN.name,
        tagline:         ADN.tagline,
        industry:        ADN.industry,
        primary_color:   ADN.primary_color,
        secondary_color: ADN.secondary_color,
        mission:         ADN.mission,
        vision:          ADN.vision,
        plan:            ADN.plan,
        tier:            ADN.tier,
        max_humans:      ADN.max_humans,
        max_agents:      ADN.max_agents,
        tenant_type:     ADN.tenant_type,
        campus_config:   { campus_enabled: true },
      },
    });
  } else {
    console.log(`✅ Creando tenant "${ADN.slug}"...`);
    tenant = await prisma.tenant.create({
      data: {
        ...ADN,
        status: 'active',
        campus_config: { campus_enabled: true },
      },
    });
  }

  const tenantId = tenant.id;
  console.log(`   Tenant ID: ${tenantId}\n`);

  // 2. Departamentos
  const deptMap: Record<string, string> = {};
  for (const d of DEPARTMENTS) {
    const existing = await prisma.department.findFirst({
      where: { tenant_id: tenantId, name: d.name },
    });
    const dept = existing
      ? await prisma.department.update({ where: { id: existing.id }, data: d })
      : await prisma.department.create({ data: { tenant_id: tenantId, ...d } });
    deptMap[d.name] = dept.id;
    console.log(`   ${existing ? '↻' : '+'} Depto: ${d.name}`);
  }

  // 3. Horario laboral
  let schedule = await prisma.schedule.findFirst({
    where: { tenant_id: tenantId, name: SCHEDULE.name },
  });
  if (!schedule) {
    schedule = await prisma.schedule.create({ data: { tenant_id: tenantId, ...SCHEDULE } });
    console.log(`\n   + Horario: ${SCHEDULE.name}`);
  } else {
    console.log(`\n   ↻ Horario: ${SCHEDULE.name} (ya existe)`);
  }

  // 4. Equipo humano
  console.log('\n👤 Configurando equipo humano...');
  const humanSlots: Record<string, string> = {}; // name → id

  for (const h of HUMANS) {
    const existing = await prisma.teamSlot.findFirst({ where: { email: h.email } });
    const hash = await bcrypt.hash(h.password, 12);
    const deptId = deptMap[h.department_name];

    const slot = existing
      ? await prisma.teamSlot.update({
          where: { id: existing.id },
          data: { name: h.name, role: h.role as any, department_id: deptId, schedule_id: schedule.id },
        })
      : await prisma.teamSlot.create({
          data: {
            tenant_id:    tenantId,
            name:         h.name,
            email:        h.email,
            password_hash: hash,
            role:         h.role as any,
            type:         'HUMAN',
            department_id: deptId,
            schedule_id:  schedule.id,
          },
        });

    humanSlots[h.name] = slot.id;
    console.log(`   ${existing ? '↻' : '+'} ${h.role.toUpperCase()}: ${h.name} <${h.email}>`);
  }

  // 5. Agentes IA
  console.log('\n🤖 Configurando agentes IA...');
  const ownerSlotId = humanSlots['Founder / Técnico'];
  const agentSlots: Record<string, string> = {};

  for (const a of AGENTS) {
    const existing = await prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, name: a.name, type: 'AI_AGENT' },
    });
    const deptId = a.department_name ? deptMap[a.department_name] : undefined;
    const instructions = typeof a.instructions === 'function'
      ? a.instructions('Founder / Técnico')
      : a.instructions;

    const agentData: any = {
      tenant_id:    tenantId,
      name:         a.name,
      type:         'AI_AGENT',
      role:         'employee',
      status:       'ONLINE',
      agent_role:   a.agent_role,
      agent_scope:  a.agent_scope,
      department_id: deptId,
      agent_config: { model: a.model, instructions, tools: [] },
    };

    // CEO Agent es personal del owner
    if (a.agent_role === 'ceo') {
      agentData.owner_slot_id = ownerSlotId;
    }

    const slot = existing
      ? await prisma.teamSlot.update({ where: { id: existing.id }, data: agentData })
      : await prisma.teamSlot.create({ data: agentData });

    agentSlots[a.name] = slot.id;
    console.log(`   ${existing ? '↻' : '+'} ${a.agent_role.toUpperCase()}: ${a.name}`);
  }

  // 6. Rooms (campus)
  console.log('\n🗺️  Configurando campus...');
  const existingRooms = await prisma.room.findMany({ where: { tenant_id: tenantId } });
  if (existingRooms.length === 0) {
    await prisma.room.createMany({
      data: ROOMS.map(r => ({ tenant_id: tenantId, ...r })),
    });
    console.log(`   + ${ROOMS.length} salas creadas`);
  } else {
    console.log(`   ↻ Campus ya configurado (${existingRooms.length} salas)`);
  }

  // 7. Desk del owner (dashboard inicial)
  console.log('\n🖥️  Configurando escritorio del owner...');
  const ownerDash = await prisma.dashboardConfig.findFirst({
    where: { tenant_id: tenantId, slot_id: ownerSlotId, is_default: true },
  });

  if (!ownerDash) {
    const dash = await prisma.dashboardConfig.create({
      data: {
        tenant_id: tenantId,
        slot_id:   ownerSlotId,
        name:      'Escritorio MentorIA',
        is_default: true,
        layout:    { cols: 12, rowHeight: 80 },
      },
    });

    await prisma.dashboardWidget.createMany({
      data: OWNER_DESK_WIDGETS.map(w => ({
        dashboard_id: dash.id,
        tenant_id:    tenantId,
        ...w,
      })),
    });
    console.log(`   + Dashboard creado con ${OWNER_DESK_WIDGETS.length} widgets`);
  } else {
    console.log(`   ↻ Dashboard ya existe`);
  }

  // 8. Onboarding marcado como completado
  const progress = await prisma.onboardingProgress.findFirst({ where: { tenant_id: tenantId } });
  if (!progress) {
    await prisma.onboardingProgress.create({
      data: {
        tenant_id:       tenantId,
        current_step:    6,
        steps_completed: ['company_created', 'departments_set', 'team_configured', 'schedule_set', 'rooms_set', 'launched'],
        template_used:   'mentoria',
        completed_at:    new Date(),
      },
    });
    console.log('\n   ✅ Onboarding marcado como completado');
  }

  // 9. Propósito estratégico (AUP)
  console.log('\n🎯 Configurando propósito estratégico (AUP)...');
  const existingPurpose = await prisma.strategicPurpose.findFirst({ where: { tenant_id: tenantId } });
  if (!existingPurpose) {
    await prisma.strategicPurpose.create({
      data: {
        tenant_id: tenantId,
        vision:    ADN.vision,
        mission:   ADN.mission,
        values: [
          'Automatizar primero — si algo se hace más de una vez, existe un workflow para ello',
          'Brief antes de producir — sin brief aprobado no se genera contenido',
          'DC como guardián de calidad — aprueba antes del cliente, siempre',
          'Plantillas para todo — cada cliente nuevo replica una instancia en < 1 día',
          'Dogfooding obligatorio — MentorIA usa sus propios productos primero',
          'Humanos y agentes IA son tratados igual en la capa de negocio',
        ],
      },
    });
    console.log('   + Propósito estratégico creado');
  } else {
    console.log('   ↻ Propósito estratégico ya existe');
  }

  // 10. Culture Engine — identidad operativa completa
  console.log('\n🧬 Configurando Culture Engine...');

  // ── 10a. Cultura operativa (CultureConfig + principios + rituales) ──────────
  let cultureConfig = await prisma.cultureConfig.findUnique({ where: { tenant_id: tenantId } });
  if (!cultureConfig) {
    cultureConfig = await prisma.cultureConfig.create({
      data: {
        tenant_id: tenantId,
        purpose:
          'Dar a los negocios latinoamericanos acceso a equipos completos de agentes IA — ' +
          'para que ningún emprendedor tenga que elegir entre crecer y poder pagarlo.',
        problem_statement:
          'Las PYMEs tienen acceso a las mismas herramientas de IA que las corporaciones, ' +
          'pero no tienen quién las opere. Pagan suscripciones que no usan porque necesitan un equipo técnico para activarlas.',
        desired_impact:
          'Que cualquier negocio de una persona pueda operar con la capacidad de un equipo de 10 — ' +
          'sin contratar, sin depender de un técnico y sin perder el control.',
        operative_philosophy: [
          'Los agentes trabajan junto a los humanos — nunca los reemplazan',
          'La automatización libera tiempo para las decisiones que solo un humano puede tomar',
          'Si algo se hace más de una vez, existe un workflow para ello',
          'El sistema opera; el humano decide y cuida la relación',
        ],
        anti_values: [
          { behavior: 'Publicar sin aprobación del Director Creativo', reason: 'La calidad es la promesa — una publicación incorrecta daña la relación con el cliente' },
          { behavior: 'Improvisar el onboarding en lugar de usar el template', reason: 'La replicabilidad es lo que nos permite escalar — un onboarding ad-hoc rompe el sistema' },
          { behavior: 'Hacer manualmente algo que ya tiene workflow', reason: 'Si hay automatización y no la usas, estás compitiendo contra tu propia eficiencia' },
          { behavior: 'Prometer o producir sin brief aprobado', reason: 'Sin brief, el cliente aprueba algo que no pidió — y el equipo trabajó sin dirección' },
          { behavior: 'Reportar un problema sin propuesta de solución', reason: 'El problema + solución avanza; el problema solo paraliza' },
        ],
        ai_principles: [
          'Antes de contratar, evaluamos si un agente puede cubrir el rol',
          'Los agentes tienen las mismas métricas y responsabilidades que el equipo humano',
          'La IA cubre el volumen; el humano cuida la relación y toma la decisión estratégica',
          'MentorIA usa sus propios agentes primero — dogfooding obligatorio',
        ],
      },
    });

    await prisma.culturePrinciple.createMany({
      data: [
        {
          tenant_id:   tenantId,
          culture_id:  cultureConfig.id,
          name:        'Automatizar primero',
          observable_behavior: 'Cuando detectas una tarea repetitiva, abres un ticket para automatizarla antes de hacerla manualmente por segunda vez.',
          sort_order:  1,
        },
        {
          tenant_id:   tenantId,
          culture_id:  cultureConfig.id,
          name:        'Brief antes de producir',
          observable_behavior: 'Cuando un cliente o colega pide "algo rápido", preguntas el brief antes de empezar. Si no hay brief, no hay entregable.',
          sort_order:  2,
        },
        {
          tenant_id:   tenantId,
          culture_id:  cultureConfig.id,
          name:        'DC como guardián de calidad',
          observable_behavior: 'Ningún entregable creativo llega al cliente sin el visto bueno del DC. Si el DC no ha revisado, no se envía.',
          sort_order:  3,
        },
        {
          tenant_id:   tenantId,
          culture_id:  cultureConfig.id,
          name:        'Plantillas para todo',
          observable_behavior: 'Cuando onboardeas un cliente, usas el template estandarizado. Si el template no funciona para el caso, propones una mejora al template, no una solución ad-hoc.',
          sort_order:  4,
        },
        {
          tenant_id:   tenantId,
          culture_id:  cultureConfig.id,
          name:        'Dogfooding obligatorio',
          observable_behavior: 'Antes de implementar algo para un cliente, lo implementamos en nuestra propia operación. Si no lo usamos nosotros, no lo vendemos.',
          sort_order:  5,
        },
        {
          tenant_id:   tenantId,
          culture_id:  cultureConfig.id,
          name:        'Humanos y agentes: mismo nivel operativo',
          observable_behavior: 'Cuando asignas una tarea, evalúas si debe hacerla un humano o un agente con la misma lógica. Los agentes tienen objetivos, KSFs y reportan igual que el equipo humano.',
          sort_order:  6,
        },
      ],
    });

    await prisma.cultureRitual.createMany({
      data: [
        {
          tenant_id:    tenantId,
          culture_id:   cultureConfig.id,
          name:         'Check-in semanal con Atlas',
          ritual_type:  'WEEKLY',
          duration_minutes: 15,
          description:  'El Founder revisa con Atlas los KPIs, el estado de los clientes y las prioridades de la semana.',
          agenda:       { items: ['¿Qué debo hacer hoy?', 'Estado de clientes', 'Alertas de KSFs', 'Prioridades de la semana'] } as any,
          sort_order:   1,
        },
        {
          tenant_id:    tenantId,
          culture_id:   cultureConfig.id,
          name:         'Ciclo semanal de contenido',
          ritual_type:  'WEEKLY',
          duration_minutes: 0,
          description:  'Lunes: research + copies. Martes: grabación. Miércoles: edición + aprobación DC. Jueves: aprobación cliente. Viernes: publicación.',
          agenda:       { items: ['Lunes — Research + copies + guiones', 'Martes — Cliente graba / sube material', 'Miércoles — Edición + revisión DC', 'Jueves — Aprobación cliente', 'Viernes — Publicación'] } as any,
          sort_order:   2,
        },
        {
          tenant_id:    tenantId,
          culture_id:   cultureConfig.id,
          name:         'Review mensual de salud del sistema',
          ritual_type:  'MONTHLY',
          duration_minutes: 30,
          description:  'Revisión de workflows activos, clientes en riesgo, agentes con bajo rendimiento y oportunidades de automatización nueva.',
          agenda:       { items: ['Estado de workflows n8n', 'Clientes en riesgo de churn', 'KSFs por debajo de meta', 'Nuevas automatizaciones propuestas'] } as any,
          sort_order:   3,
        },
      ],
    });

    console.log('   + CultureConfig + 6 principios + 3 rituales creados');
  } else {
    console.log('   ↻ CultureConfig ya existe');
  }

  // ── 10b. Founder DNA ─────────────────────────────────────────────────────────
  const existingFounder = await prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } });
  if (!existingFounder && ownerSlotId) {
    await prisma.founderProfile.create({
      data: {
        tenant_id:  tenantId,
        slot_id:    ownerSlotId,
        industry_change:
          'Las PYMEs latinoamericanas no tienen acceso a departamentos completos de IA — pagan por herramientas pero no tienen quién las opere. ' +
          'Quiero que cualquier negocio de una persona pueda tener un equipo de agentes funcionando en días, no meses.',
        differentiator:
          'No somos un sistema genérico — la hiperpersonalización es nuestra propuesta central. ' +
          'Cada empresa que entra a MentorIA termina con agentes que suenan, piensan y operan como esa empresa específica, ' +
          'no como un template de IA de catálogo. El modelo OPC (One Person Company + agents) es nuestra apuesta.',
        loved_behaviors: [
          'Traer una solución junto con el problema',
          'Documentar antes de entregar',
          'Automatizar sin que nadie lo pida',
          'Usar el producto antes de venderlo',
          'Hacer más con menos recursos',
        ],
        zero_tolerance: [
          'Decir que somos un sistema genérico — somos hiperpersonalización, lo contrario',
          'Publicar contenido sin aprobación del Director Creativo',
          'Improvisar el onboarding en lugar de usar el proceso establecido',
          'Hacer manualmente algo que ya tiene workflow',
          'Prometer o producir sin brief aprobado',
          'Reportar un problema sin propuesta de solución',
        ],
        hated_inefficiencies: [
          'Onboarding manual que depende de una persona específica',
          'Información dispersa en múltiples herramientas sin sincronización',
          'Reuniones sin agenda ni acción concreta',
          'Contenido producido que nunca se publica',
          'Datos que se capturan dos veces',
        ],
        doing_well_means:
          'Un cliente nuevo está operando con sus agentes en menos de 24 horas. ' +
          'El contenido semanal sale en tiempo sin intervención manual. ' +
          'Los workflows no se caen y cuando lo hacen, el agente ya notificó antes de que alguien lo reporte.',
        team_feeling:
          'Orgullosos de usar tecnología que la mayoría ni conoce. ' +
          'Libres de las tareas repetitivas — el tiempo lo dedican a lo que mueve el negocio. ' +
          'Parte de algo que va a cambiar cómo trabajan los negocios pequeños en Latinoamérica.',
        client_energy:
          '"Mis agentes están trabajando mientras yo duermo." ' +
          'Confianza de que el sistema funciona sin que ellos estén pendientes. ' +
          'Sensación de tener un equipo completo sin la nómina que eso implicaría.',
        ai_tasks: [
          'Research de contenido y tendencias',
          'Generación de copies, guiones y propuestas',
          'Seguimiento de pipeline de ventas',
          'Alertas de sistemas caídos o workflows detenidos',
          'Reportes semanales y mensuales',
          'Onboarding automatizado de nuevos clientes',
          'Coordinación de entregas entre departamentos',
        ],
        ai_never_replace: [
          'La relación personal con el cliente',
          'La decisión final de cierre de venta',
          'La aprobación creativa del Director Creativo',
          'La estrategia del negocio y las apuestas a largo plazo',
          'El criterio ante situaciones de crisis con un cliente',
        ],
        tone_description:   'Directo y técnico pero accesible. Ejecutivo sin ser frío. Español latinoamericano, sin anglicismos innecesarios.',
        leadership_style:   'Asumo que el equipo sabe qué hacer — mi trabajo es eliminar los obstáculos y asegurarme de que el sistema funcione.',
        operating_style:    'Primero construyo el sistema, luego lo opero. Si estoy haciendo algo manualmente más de dos veces, es porque aún no terminé de construir.',
        key_obsessions: [
          'Tiempo de setup: cada cliente nuevo en < 1 día',
          'Workflows sin caídas — uptime operativo',
          'El Brief como punto de partida de todo',
          'Dogfooding: nosotros somos el primer cliente',
        ],
        decision_principles: [
          'Si crea dependencia de una persona, no escala — busco la alternativa sistémica',
          'Si no lo usaría yo, no se lo vendo a un cliente',
          'El DC decide en lo creativo; yo decido en lo estratégico',
          'Cuando hay duda entre velocidad y calidad, elijo calidad — el cliente lo nota tarde pero lo nota',
        ],
      },
    });
    console.log('   + Founder DNA creado');
  } else {
    console.log('   ↻ Founder DNA ya existe');
  }

  // ── 10c. Culture Blueprint ───────────────────────────────────────────────────
  const existingBlueprint = await prisma.cultureBlueprint.findUnique({ where: { tenant_id: tenantId } });
  if (!existingBlueprint) {
    await prisma.cultureBlueprint.create({
      data: {
        tenant_id: tenantId,
        philosophy_statements: [
          'Los agentes de IA trabajan junto a los humanos, no los reemplazan.',
          'Automatizar primero — si algo se hace más de una vez, existe un workflow para ello.',
          'Brief antes de producir — sin brief aprobado no se genera nada.',
          'Plantillas para todo — cada cliente nuevo en menos de un día.',
          'Dogfooding obligatorio — MentorIA usa sus propios productos primero.',
          'Humanos y agentes tienen las mismas métricas y responsabilidades.',
        ],
        operational_rules: [
          { trigger: 'Cliente pide contenido sin brief', expected_behavior: 'Solicitar el brief antes de iniciar cualquier producción', metric: '100% de proyectos iniciados con brief aprobado', owner: 'Agente de Marketing' },
          { trigger: 'Entregable creativo listo', expected_behavior: 'Enviar al DC para aprobación antes de compartir con el cliente', metric: 'Cero entregas directas al cliente sin revisión DC', owner: 'Director Creativo' },
          { trigger: 'Tarea repetitiva detectada (segunda vez)', expected_behavior: 'Crear ticket de automatización antes de ejecutar manualmente', metric: 'Tiempo de automatización < 1 semana desde detección', owner: 'Hub Técnico' },
          { trigger: 'Nuevo cliente confirmado', expected_behavior: 'Ejecutar template de onboarding — no improvisar pasos', metric: 'Setup completo en < 24 horas', owner: 'Agente de Operaciones' },
          { trigger: 'Workflow caído o alerta de sistema', expected_behavior: 'Notificar al Founder con: (1) qué falló, (2) clientes afectados, (3) paso donde se detuvo', metric: 'Tiempo de notificación < 15 minutos', owner: 'Agente de Operaciones' },
        ],
        response_standards: [
          { channel: 'WhatsApp (clientes)', max_hours: 2, note: 'Acuse de recibo inmediato; resolución en 2h en horario laboral' },
          { channel: 'Email (prospectos)', max_hours: 24, note: 'Respuesta con propuesta o siguiente paso definido' },
          { channel: 'Interno (FlowDesk)', max_hours: 4, note: 'Mensajes internos de equipo y agentes' },
          { channel: 'Urgencias de cliente', max_hours: 1, note: 'Cualquier falla que afecte la operación de un cliente activo' },
        ],
        decision_frameworks: [
          { situation: 'Conflicto entre velocidad de entrega y calidad', principle: 'La calidad protege la relación a largo plazo', action: 'Comunicar al cliente el ajuste en tiempo con razón específica. Nunca entregar algo que no pasaría la revisión del DC.' },
          { situation: 'Cliente pide algo fuera del alcance del servicio', principle: 'El alcance protege la operación', action: 'Definir si es una expansión de servicio (cotizar) o un favor (no hacerlo sin contrato). Registrar en Airtable.' },
          { situation: 'Falla de sistema en horario no laboral', principle: 'La operación del cliente no espera', action: 'El Agente de Operaciones notifica de forma autónoma. El Founder interviene solo si requiere decisión estratégica.' },
          { situation: 'Presión para contratar más personal', principle: 'Primero evaluar si un agente puede cubrir el rol', action: 'Definir el scope del rol → buscar si existe agente disponible → contratar humano solo si el rol requiere criterio no automatizable.' },
        ],
        company_language: [
          { term: 'Herramienta de IA', meaning: 'Agente', context: 'Usamos "agente" porque trabaja de forma autónoma, no es solo una herramienta pasiva' },
          { term: 'Chatbot', meaning: 'Agente conversacional', context: 'Cuando el agente tiene interfaz de chat' },
          { term: 'Cliente', meaning: 'Tenant', context: 'En el contexto técnico de FlowDesk' },
          { term: 'Configurar', meaning: 'Onboardear / provisionar', context: 'El proceso de dar de alta a un cliente es "onboarding", no "configuración"' },
          { term: 'Workflow caído', meaning: 'Alerta de sistema', context: 'Cuando n8n u otro sistema falla' },
          { term: 'Ciclo semanal', meaning: 'Sprint de contenido', context: 'El proceso de lunes a viernes de producción de contenido' },
        ],
      },
    });
    console.log('   + Culture Blueprint creado');
  } else {
    console.log('   ↻ Culture Blueprint ya existe');
  }

  // ── 10d. Operating Map ───────────────────────────────────────────────────────
  const existingMap = await prisma.operatingMap.findUnique({ where: { tenant_id: tenantId } });
  if (!existingMap) {
    await prisma.operatingMap.create({
      data: {
        tenant_id: tenantId,
        current_systems: [
          { name: 'FlowDesk',      category: 'OS Empresarial', used_for: 'Operación interna — campus, agentes, tareas, metas AUP', status: 'activo (dogfooding)' },
          { name: 'n8n',           category: 'Automatización', used_for: 'Motor de workflows — ciclo de contenido, alertas, onboarding cliente', status: 'activo' },
          { name: 'Evolution API', category: 'Comunicación',   used_for: 'WhatsApp Business — comunicación con clientes y agentes conversacionales', status: 'activo' },
          { name: 'Airtable',      category: 'ERP / Base de datos', used_for: 'CRM de clientes, gestión de contenido, datos por cliente', status: 'activo' },
          { name: 'Softr',         category: 'Dashboard cliente', used_for: 'Portal web del cliente conectado a Airtable', status: 'activo' },
          { name: 'Canva Teams',   category: 'Diseño',         used_for: 'Brand kits por cliente, contenido visual', status: 'activo' },
          { name: 'Google Drive',  category: 'Almacenamiento', used_for: 'Assets por cliente — videos, imágenes, propuestas', status: 'activo' },
          { name: 'Hostinger VPS', category: 'Infraestructura', used_for: 'Servidor Ubuntu donde viven n8n, Evolution API y servicios propios', status: 'activo' },
        ],
        key_processes: [
          {
            name:       'Onboarding de nuevo cliente (Tipo B)',
            owner_name: 'Agente de Operaciones',
            steps:      ['Brief firmado → Brief en Airtable', 'Duplicar template n8n', 'Crear base Airtable cliente', 'Configurar Softr dashboard', 'Crear carpeta Google Drive', 'Configurar Canva brand kit', 'Prueba del ciclo semanal', 'Entrega con guía de uso'],
            friction:   ['Pasos manuales en Airtable y Canva aún sin automatizar', 'Dependencia del Founder para configurar credenciales iniciales'],
            ai_potential: 'Provisioning automático via API de Airtable, Canva y Google Drive — ya iniciado con AirtableService',
          },
          {
            name:       'Ciclo semanal de contenido',
            owner_name: 'Agente de Marketing',
            steps:      ['Lunes: research + copies + guiones', 'Martes: cliente graba', 'Miércoles: edición + revisión DC', 'Jueves: aprobación cliente', 'Viernes: publicación'],
            friction:   ['Coordinación manual de aprobaciones via WhatsApp', 'Sin trazabilidad de qué versión aprobó el DC vs el cliente'],
            ai_potential: 'Flujo de aprobación automático en FlowDesk con notificaciones y registro de estado',
          },
          {
            name:       'Pipeline de ventas (Tipo B)',
            owner_name: 'Agente de Ventas',
            steps:      ['Prospecto contacta por WhatsApp/Instagram', 'Calificación por agente', 'Demo del producto', 'Propuesta con precio', 'Cierre — confirmación del Founder', 'Onboarding'],
            friction:   ['El Founder es cuello de botella en la confirmación de cierre', 'Sin automatización de seguimiento de propuestas enviadas'],
            ai_potential: 'Calificación y seguimiento automático; el Founder interviene solo en cierre',
          },
        ],
        pain_points: [
          { area: 'Onboarding', description: 'Pasos manuales en Canva y algunas configuraciones de Airtable que aún no están en la API', impact: 'El setup puede demorar más de 24h si hay incidencias manuales' },
          { area: 'Aprobaciones', description: 'El flujo de aprobación DC→cliente sucede por WhatsApp sin trazabilidad centralizada', impact: 'Riesgo de publicar versión incorrecta o perder el historial de cambios solicitados' },
          { area: 'Visibilidad', description: 'No hay un dashboard centralizado de estado de todos los clientes en tiempo real', impact: 'El Founder debe preguntar al Agente de Operaciones o revisar Airtable manualmente' },
        ],
      },
    });
    console.log('   + Operating Map creado');
  } else {
    console.log('   ↻ Operating Map ya existe');
  }

  // ── 10e. Communication Profile (muestras base — calibrar después con Atlas) ──
  const existingComm = await prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } });
  if (!existingComm) {
    await prisma.communicationProfile.create({
      data: {
        tenant_id:           tenantId,
        tone:                'directo',
        energy:              'alto',
        formality:           'media',
        structure:           'bullets',
        avg_length:          'medio',
        calibration_quality: 'low',
        samples_count:       2,
        key_phrases: [
          'el agente trabaja junto a tu equipo',
          'automatizar primero',
          'sin brief no hay producción',
          'en menos de un día',
          'inteligencia humana, potencia artificial',
        ],
        avoid_phrases: [
          'somos un sistema genérico',
          'solución de IA estándar',
          'chatbot',
          'robot',
          'herramienta de IA',
          'automatizamos tus procesos',
          'implementamos soluciones de IA',
          'sustituir al humano',
          'implementación compleja',
        ],
        custom_vocab: [
          { original: 'chatbot', preferred: 'agente conversacional' },
          { original: 'herramienta de IA', preferred: 'agente IA' },
          { original: 'automatización', preferred: 'el sistema lo hace solo' },
          { original: 'configurar', preferred: 'activar / provisionar' },
        ],
        voice_summary:
          'MentorIA comunica con la energía de quien ya probó lo que vende. ' +
          'Directo, técnico pero sin jerga innecesaria. Español latinoamericano. ' +
          'No convence — demuestra. Habla de resultados concretos y sistemas que funcionan, no de posibilidades.',
        samples: [
          {
            type: 'tagline',
            content: 'inteligencia humana, potencia artificial',
            label: 'Tagline oficial',
          },
          {
            type: 'mission',
            content: 'Dar a los negocios latinoamericanos acceso a departamentos completos de inteligencia artificial que trabajen junto a sus equipos humanos — reduciendo la dependencia de personal costoso, eliminando tareas repetitivas y liberando tiempo para lo que realmente mueve el negocio.',
            label: 'Misión oficial',
          },
        ],
      },
    });
    console.log('   + Communication Profile creado (muestras base — agregar más con Atlas para mejorar calibración)');
  } else {
    console.log('   ↻ Communication Profile ya existe');
  }

  console.log(`
╔══════════════════════════════════════════════════════╗
║  MentorIA Systems — seed completado                  ║
╠══════════════════════════════════════════════════════╣
║  Tenant ID : ${tenantId.padEnd(38)} ║
║  Humanos   : ${String(HUMANS.length).padEnd(38)} ║
║  Agentes   : ${String(AGENTS.length).padEnd(38)} ║
║  Deptos    : ${String(DEPARTMENTS.length).padEnd(38)} ║
║  Salas     : ${String(ROOMS.length).padEnd(38)} ║
╠══════════════════════════════════════════════════════╣
║  Culture Engine:                                     ║
║  · Founder DNA — completo                            ║
║  · 6 principios + 3 rituales                         ║
║  · Culture Blueprint — completo                      ║
║  · Operating Map — 8 sistemas, 3 procesos            ║
║  · Communication Profile — base (agregar muestras)   ║
╠══════════════════════════════════════════════════════╣
║  Siguiente paso: pedir a Atlas "calibra mi perfil"   ║
╠══════════════════════════════════════════════════════╣
║  Login owner: ${(process.env.MENTORIA_OWNER_EMAIL ?? 'founder@mentoria.ai').padEnd(37)} ║
║  ⚠️  Cambia las passwords en primer login            ║
╚══════════════════════════════════════════════════════╝
`);
}

main()
  .catch(e => { console.error('❌ Error en seed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
