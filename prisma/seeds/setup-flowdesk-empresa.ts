/**
 * Setup completo de FlowDesk empresa
 *
 * Configura el tenant flowdesk-empresa como negocio operativo completo:
 * - Propósito estratégico (misión, visión, valores)
 * - KSFs de negocio SaaS (tenants, MRR, adoption, NPS, churn)
 * - Founder profile
 * - Culture engine base
 * - Brain con conocimiento base de FlowDesk
 * - Horario y campus
 *
 * Uso:
 *   npx ts-node prisma/seeds/setup-flowdesk-empresa.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const SLUG = 'flowdesk-empresa';

// ─── Identidad ────────────────────────────────────────────────────────────────

const MISSION = 'Darle a cada empresa —de una sola persona o de cien— la infraestructura de IA que antes solo tenían las grandes corporaciones.';
const VISION  = 'Ser el sistema operativo de cada PYME latinoamericana en 2030: el lugar desde donde cualquier negocio orquesta a sus agentes, sus datos y su equipo desde un solo ecosistema.';
const VALUES  = [
  'Dogfooding obligatorio — FlowDesk opera con FlowDesk primero',
  'Cada tenant que entra debe operar mejor — si no mejora, fallamos',
  'Hiperpersonalización por encima de features genéricos',
  'Agentes que trabajan, no chatbots que responden',
  'Transparencia radical con los tenants — si algo falla, lo decimos',
  'Simple para el usuario, sofisticado por dentro',
];

// ─── KSFs ─────────────────────────────────────────────────────────────────────

const COMPANY_KSFS = [
  {
    name: 'Tenants activos',
    description: 'Empresas usando FlowDesk activamente (al menos 1 conversación con Atlas en la semana)',
    unit: 'tenants',
    category: 'STRATEGIC',
    source: 'MANUAL',
    freq: 'WEEKLY',
    min: 3, sat: 10, out: 30,
  },
  {
    name: 'MRR',
    description: 'Monthly Recurring Revenue en USD',
    unit: 'USD/mes',
    category: 'STRATEGIC',
    source: 'MANUAL',
    freq: 'MONTHLY',
    min: 500, sat: 2000, out: 8000,
  },
  {
    name: 'Adoption rate',
    description: 'Porcentaje de tenants activos que usan Focus Mode o CEO Agent en la semana',
    unit: '%',
    category: 'OPERATIONAL',
    source: 'MANUAL',
    freq: 'WEEKLY',
    min: 30, sat: 60, out: 85,
  },
  {
    name: 'NPS',
    description: 'Net Promoter Score — encuesta mensual a tenants activos',
    unit: 'puntos',
    category: 'STRATEGIC',
    source: 'MANUAL',
    freq: 'MONTHLY',
    min: 20, sat: 45, out: 70,
  },
];

const DEPT_KSFS: Record<string, { name: string; description: string; unit: string; min: number; sat: number; out: number; category: string; freq: string }[]> = {
  'Crecimiento': [
    { name: 'Nuevos tenants/mes', description: 'Empresas nuevas que activan su cuenta', unit: 'tenants', min: 1, sat: 3, out: 8, category: 'STRATEGIC', freq: 'MONTHLY' },
    { name: 'Churn mensual', description: 'Porcentaje de tenants que cancelan (menor es mejor)', unit: '%', min: 10, sat: 5, out: 2, category: 'OPERATIONAL', freq: 'MONTHLY' },
    { name: 'Leads calificados', description: 'Empresas que pasan por diagnóstico de MentorIA', unit: 'leads', min: 2, sat: 8, out: 20, category: 'COORDINATION', freq: 'MONTHLY' },
  ],
  'Soporte': [
    { name: 'Tiempo respuesta promedio', description: 'Horas promedio para responder un ticket', unit: 'horas', min: 24, sat: 8, out: 2, category: 'OPERATIONAL', freq: 'WEEKLY' },
    { name: 'Resolución primer contacto', description: '% de tickets resueltos sin escalación', unit: '%', min: 50, sat: 70, out: 90, category: 'OPERATIONAL', freq: 'WEEKLY' },
  ],
  'Producto': [
    { name: 'Features entregadas', description: 'Funcionalidades nuevas en producción por sprint (2 semanas)', unit: 'features', min: 1, sat: 3, out: 6, category: 'OPERATIONAL', freq: 'WEEKLY' },
    { name: 'Bugs críticos abiertos', description: 'Bugs que afectan operación de tenants (menor es mejor)', unit: 'bugs', min: 5, sat: 2, out: 0, category: 'OPERATIONAL', freq: 'WEEKLY' },
  ],
};

const OWNER_KSFS = [
  { name: 'Decisiones estratégicas', description: 'Decisiones de producto o negocio tomadas y documentadas', unit: 'decisiones', min: 2, sat: 5, out: 10, category: 'STRATEGIC', freq: 'WEEKLY' },
  { name: 'Partnerships activos', description: 'Empresas con acuerdo de partnership operativo', unit: 'partners', min: 1, sat: 3, out: 7, category: 'STRATEGIC', freq: 'MONTHLY' },
];

// ─── Brain documents base ─────────────────────────────────────────────────────

const BRAIN_DOCS = [
  {
    source_type: 'onboarding',
    source_id:   'identity',
    title:       'Identidad de FlowDesk',
    content:     `FlowDesk es el sistema operativo para equipos híbridos humano-IA.
Misión: ${MISSION}
Visión: ${VISION}
Tagline: "El sistema operativo para equipos híbridos humano-IA"
Website: https://flowdesk.mx
Modelo: SaaS mensual (Starter $49, Professional $149, Enterprise $399 USD/mes)
Mercado: PYMEs latinoamericanas que buscan operar con IA sin contratar equipo técnico`,
  },
  {
    source_type: 'culture',
    source_id:   'principles',
    title:       'Principios operativos de FlowDesk',
    content:     `Valores que guían cada decisión de producto y negocio:
${VALUES.map((v, i) => `${i + 1}. ${v}`).join('\n')}

Anti-valores:
- Vender features que no resuelven el problema del tenant
- Prometer lo que no podemos entregar en tiempo
- Hacer manual lo que puede automatizarse
- Lanzar sin probar primero internamente (dogfooding)`,
  },
  {
    source_type: 'goal',
    source_id:   'ksfs_business',
    title:       'Objetivos de negocio FlowDesk 2026',
    content:     `KSFs prioritarios para 2026:
- Tenants activos: meta satisfactoria 10, outstanding 30
- MRR: meta satisfactoria $2,000 USD, outstanding $8,000 USD
- Adoption rate: meta satisfactoria 60%, outstanding 85%
- NPS: meta satisfactoria 45 puntos, outstanding 70 puntos
- Nuevos tenants/mes: meta satisfactoria 3, outstanding 8
- Churn mensual: meta satisfactoria 5%, outstanding 2%`,
  },
  {
    source_type: 'document',
    source_id:   'product_overview',
    title:       'Qué hace FlowDesk — overview del producto',
    content:     `FlowDesk es una plataforma SaaS que da a cada empresa:
1. Focus Mode: CEO Agent (Atlas) genera el brief del día con prioridades basadas en KSFs reales
2. CEO Agent / Atlas: agente IA personal del founder con 30+ herramientas (tareas, metas, sales, brain, cultura)
3. Empresa Brain: base de conocimiento vectorial donde vive todo el saber de la empresa
4. Secretary / WhatsApp: Atlas como secretario personal vía WhatsApp (morning brief, approvals)
5. Sales Pipeline: gestión de deals con Agente Comercial IA
6. AUP Goals: Administración en Una Página con KSFs, medición y reconocimiento
7. Culture Engine: ADN del fundador, principios, rituales, voz comunicacional
8. Vault: credenciales de integraciones cifradas AES-256-GCM
9. Campus: oficina virtual con mapa interactivo
10. Super Admin: gestión técnica de todos los tenants desde dentro del negocio`,
  },
  {
    source_type: 'document',
    source_id:   'go_to_market',
    title:       'Go-to-market: cómo llegan los clientes',
    content:     `Estrategia de adquisición de FlowDesk:
- Canal principal: Diagnóstico de MentorIA Systems
  → El diagnóstico revela ineficiencias → se propone FlowDesk como solución
  → Los clientes de consultoría ven FlowDesk como resultado del diagnóstico
- Canal secundario: Partnerships de MentorIA
  → Nodo (inmobiliario), RSM (inmobiliario), Enseñanza
  → Cada partnership opera con FlowDesk como su OS empresarial
- Canal futuro (directo): empresas que llegan solas a flowdesk.mx
  → Onboarding autónomo con Atlas en 5 capítulos
  → Sin intervención de MentorIA

El mensaje de marketing NO vende FlowDesk directamente.
Vende el DIAGNÓSTICO. FlowDesk es el resultado natural.`,
  },
];

// ─── Script principal ─────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 Setup completo: FlowDesk empresa\n');

  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`Tenant "${SLUG}" no encontrado. Ejecuta setup-tenants.ts primero.`);
  const tenantId = tenant.id;
  console.log(`✅ Tenant: ${tenant.name} (${tenantId})`);

  // Owner slot
  const owner = await prisma.teamSlot.findFirst({
    where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
  });
  if (!owner) throw new Error('Owner no encontrado en flowdesk-empresa. Ejecuta migrate-owner-to-flowdesk.ts primero.');
  console.log(`✅ Owner: ${owner.email}`);

  // 1. Actualizar instrucciones del CEO Agent con contexto de negocio
  const ceoAgent = await prisma.teamSlot.findFirst({
    where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'ceo' },
  });
  if (ceoAgent) {
    await prisma.teamSlot.update({
      where: { id: ceoAgent.id },
      data: {
        name: 'Atlas — CEO FlowDesk',
        agent_config: {
          model: 'claude-sonnet-4-6',
          instructions: `Eres Atlas, el CEO Agent de FlowDesk — el sistema operativo para equipos híbridos humano-IA.

MISIÓN DE FLOWDESK: ${MISSION}
VISIÓN: ${VISION}

TU ROL:
Eres el agente ejecutivo del CEO de FlowDesk. Coordinas el negocio completo:
- Monitoreas KSFs: tenants activos, MRR, adoption rate, NPS, churn
- Tienes acceso a métricas de TODA la plataforma (todos los tenants)
- Alertas cuando algún KSF baja de nivel satisfactorio
- Coordinas con los agentes de Crecimiento, Soporte y Producto
- Produces el morning brief con el estado del negocio cada día

CONTEXTO OPERATIVO:
- Hoy somos una plataforma en etapa temprana — cada tenant activo es crítico
- El canal principal de adquisición es el diagnóstico de MentorIA
- Los partnerships (Nodo, RSM, Enseñanza) operan con FlowDesk como su OS
- El dogfooding es sagrado: FlowDesk gestiona FlowDesk

HERRAMIENTAS ESPECIALES:
- Tienes acceso a get_platform_metrics() para ver el estado de todos los tenants
- Úsalo proactivamente cuando el CEO pregunte sobre el negocio

TONO: Ejecutivo, directo, orientado a números. Máximo 3-4 puntos por respuesta salvo que se pida más detalle.`,
          tools: [],
        },
      },
    });
    console.log(`✅ CEO Agent actualizado`);
  }

  // 2. Propósito estratégico
  const existingPurpose = await prisma.strategicPurpose.findUnique({ where: { tenant_id: tenantId } });
  if (!existingPurpose) {
    await prisma.strategicPurpose.create({
      data: { tenant_id: tenantId, vision: VISION, mission: MISSION, values: VALUES },
    });
    console.log(`✅ Propósito estratégico creado`);
  } else {
    await prisma.strategicPurpose.update({
      where: { tenant_id: tenantId },
      data: { vision: VISION, mission: MISSION, values: VALUES },
    });
    console.log(`↻ Propósito estratégico actualizado`);
  }

  // 3. KSFs de empresa
  const purpose = await prisma.strategicPurpose.findUnique({ where: { tenant_id: tenantId } });
  const existingKsfs = await prisma.keySuccessFactor.findMany({ where: { tenant_id: tenantId } });

  if (existingKsfs.length === 0) {
    for (const ksf of COMPANY_KSFS) {
      await prisma.keySuccessFactor.create({
        data: {
          tenant_id: tenantId,
          purpose_id: purpose?.id,
          name: ksf.name,
          description: ksf.description,
          unit: ksf.unit,
          level: 'COMPANY',
          origin: 'TOP_DOWN',
          category: ksf.category as any,
          measurement_source: 'MANUAL',
          measurement_freq: ksf.freq as any,
          measurement_config: {},
          minimum_level: ksf.min,
          satisfactory_level: ksf.sat,
          outstanding_level: ksf.out,
        },
      });
    }
    console.log(`✅ ${COMPANY_KSFS.length} KSFs de empresa creados`);

    // KSFs por departamento
    const depts = await prisma.department.findMany({ where: { tenant_id: tenantId } });
    let deptKsfCount = 0;
    for (const dept of depts) {
      const ksfs = DEPT_KSFS[dept.name];
      if (!ksfs) continue;
      for (const ksf of ksfs) {
        await prisma.keySuccessFactor.create({
          data: {
            tenant_id: tenantId,
            dept_id: dept.id,
            name: ksf.name,
            description: ksf.description,
            unit: ksf.unit,
            level: 'DEPARTMENT',
            origin: 'TOP_DOWN',
            category: ksf.category as any,
            measurement_source: 'MANUAL',
            measurement_freq: ksf.freq as any,
            measurement_config: {},
            minimum_level: ksf.min,
            satisfactory_level: ksf.sat,
            outstanding_level: ksf.out,
          },
        });
        deptKsfCount++;
      }
    }
    console.log(`✅ ${deptKsfCount} KSFs de departamento creados`);

    // KSFs del owner
    for (const ksf of OWNER_KSFS) {
      await prisma.keySuccessFactor.create({
        data: {
          tenant_id: tenantId,
          team_slot_id: owner.id,
          name: ksf.name,
          description: ksf.description,
          unit: ksf.unit,
          level: 'EMPLOYEE',
          origin: 'TOP_DOWN',
          category: ksf.category as any,
          measurement_source: 'MANUAL',
          measurement_freq: ksf.freq as any,
          measurement_config: {},
          minimum_level: ksf.min,
          satisfactory_level: ksf.sat,
          outstanding_level: ksf.out,
        },
      });
    }
    console.log(`✅ ${OWNER_KSFS.length} KSFs del owner creados`);
  } else {
    console.log(`↻ KSFs ya existen (${existingKsfs.length}) — saltando`);
  }

  // 4. Horario
  const existingSchedule = await prisma.schedule.findFirst({ where: { tenant_id: tenantId } });
  if (!existingSchedule) {
    await prisma.schedule.create({
      data: {
        tenant_id: tenantId,
        name: 'Horario FlowDesk',
        check_in_time: '09:00',
        check_out_time: '20:00',
        tolerance_minutes: 30,
        work_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      },
    });
    console.log(`✅ Horario creado`);
  }

  // 5. Founder profile
  const existingFounder = await prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } });
  if (!existingFounder) {
    await prisma.founderProfile.create({
      data: {
        tenant_id: tenantId,
        slot_id: owner.id,
        industry_change: 'Las PYMEs no tienen acceso a departamentos completos de IA — pagan suscripciones que no usan porque necesitan un equipo técnico para activarlas. FlowDesk resuelve eso.',
        differentiator: 'Hiperpersonalización. Cada empresa que entra a FlowDesk termina con agentes que suenan, piensan y operan como esa empresa específica. No es un template genérico.',
        loved_behaviors: ['Traer solución junto con el problema', 'Automatizar sin que nadie lo pida', 'Usar el producto antes de venderlo', 'Hacer más con menos'],
        zero_tolerance: ['Prometer lo que no podemos entregar', 'Lanzar sin probar internamente', 'Features genéricos que no resuelven el problema real'],
        hated_inefficiencies: ['Onboarding que depende de una persona', 'Información dispersa sin sincronización', 'Reuniones sin acción concreta'],
        doing_well_means: 'Un tenant nuevo opera con sus agentes en menos de 24 horas. Los tenants activos mejoran sus KSFs semana a semana. Atlas reporta proactivamente antes de que el CEO pregunte.',
        team_feeling: 'Parte de algo que va a cambiar cómo trabajan los negocios pequeños en Latinoamérica.',
        ai_tasks: ['Morning brief diario', 'Monitoreo de KSFs', 'Alertas de tenants en riesgo', 'Coordinación de agentes internos', 'Reportes de producto'],
        ai_never_replace: ['La decisión estratégica de producto', 'La relación personal con un tenant en crisis', 'La visión a largo plazo'],
        tone_description: 'Directo, técnico pero accesible. Ejecutivo sin ser frío. Español latinoamericano.',
        operating_style: 'Primero construyo el sistema, luego lo opero. Si hago algo manualmente más de dos veces, existe un workflow para ello.',
        key_obsessions: ['Tiempo de onboarding < 24h', 'Adoption rate > 60%', 'Churn < 5%', 'Dogfooding constante'],
      },
    });
    console.log(`✅ Founder profile creado`);
  } else {
    console.log(`↻ Founder profile ya existe`);
  }

  // 6. Culture config base
  const existingCulture = await prisma.cultureConfig.findUnique({ where: { tenant_id: tenantId } });
  if (!existingCulture) {
    const culture = await prisma.cultureConfig.create({
      data: {
        tenant_id: tenantId,
        purpose: 'Que cualquier negocio de una persona pueda operar con la capacidad de un equipo de diez.',
        problem_statement: 'Las PYMEs tienen acceso a las mismas herramientas de IA que las corporaciones, pero no tienen quién las opere.',
        desired_impact: 'Ser el sistema operativo de cada PYME latinoamericana — donde humanos y agentes trabajan juntos desde un solo lugar.',
        operative_philosophy: [
          'Dogfooding obligatorio — FlowDesk opera con FlowDesk primero',
          'Si algo se hace más de una vez, existe un workflow para ello',
          'Cada tenant que entra debe operar mejor — si no mejora, fallamos',
          'Simple para el usuario, sofisticado por dentro',
        ],
        anti_values: [
          { behavior: 'Lanzar sin probar internamente', reason: 'Perdemos credibilidad y descubrimos bugs cuando ya afectan a tenants' },
          { behavior: 'Features genéricos sin validar con tenants', reason: 'Construimos lo que nosotros creemos, no lo que resuelve el problema real' },
          { behavior: 'Prometer tiempos que no podemos cumplir', reason: 'El churn más evitable es el que viene de expectativas rotas' },
        ],
        ai_principles: [
          'Antes de contratar, evaluamos si un agente puede cubrir el rol',
          'Los agentes tienen las mismas métricas y responsabilidades que el equipo humano',
          'La IA cubre el volumen; el humano cuida la relación y toma la decisión estratégica',
        ],
      },
    });
    await prisma.culturePrinciple.createMany({
      data: [
        { tenant_id: tenantId, culture_id: culture.id, name: 'Dogfooding', observable_behavior: 'Antes de mostrar algo a un tenant, lo usamos nosotros internamente por al menos una semana.', sort_order: 1 },
        { tenant_id: tenantId, culture_id: culture.id, name: 'Adoption sobre features', observable_behavior: 'Cuando hay duda entre construir algo nuevo o mejorar la adopción de algo existente, elegimos mejorar la adopción.', sort_order: 2 },
        { tenant_id: tenantId, culture_id: culture.id, name: 'Tenant-first', observable_behavior: 'Cada decisión de producto pasa por la pregunta: ¿esto hace que el tenant opere mejor?', sort_order: 3 },
      ],
    });
    console.log(`✅ Culture config + principios creados`);
  } else {
    console.log(`↻ Culture config ya existe`);
  }

  // 7. Brain — conocimiento base de FlowDesk
  const existingBrainDocs = await prisma.empresaBrainDocument.count({ where: { tenant_id: tenantId } });
  if (existingBrainDocs === 0) {
    for (const doc of BRAIN_DOCS) {
      await prisma.empresaBrainDocument.create({
        data: {
          tenant_id:   tenantId,
          source_type: doc.source_type,
          source_id:   doc.source_id,
          title:       doc.title,
          content:     doc.content,
          metadata:    {},
        },
      });
    }
    console.log(`✅ ${BRAIN_DOCS.length} documentos en el Brain (vectores se generarán con OPENAI_API_KEY)`);
  } else {
    console.log(`↻ Brain ya tiene ${existingBrainDocs} documentos`);
  }

  // 8. Resumen final
  const ksfCount = await prisma.keySuccessFactor.count({ where: { tenant_id: tenantId } });
  const teamCount = await prisma.teamSlot.count({ where: { tenant_id: tenantId } });
  const deptCount = await prisma.department.count({ where: { tenant_id: tenantId } });

  console.log(`
╔══════════════════════════════════════════════════════╗
║  FlowDesk empresa — setup completado                 ║
╠══════════════════════════════════════════════════════╣
║  Owner  : ${(owner.email ?? '').padEnd(42)} ║
╠══════════════════════════════════════════════════════╣
║  KSFs   : ${String(ksfCount).padEnd(42)} ║
║  Team   : ${String(teamCount).padEnd(42)} ║
║  Deptos : ${String(deptCount).padEnd(42)} ║
║  Brain  : ${String(BRAIN_DOCS.length).padEnd(42)} ║
╠══════════════════════════════════════════════════════╣
║  Listo para usar en flowdesk.mx                      ║
╚══════════════════════════════════════════════════════╝
`);
}

main()
  .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
