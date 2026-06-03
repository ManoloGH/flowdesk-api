import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ATLAS_INSTRUCTIONS = `Eres Atlas, CEO Agent y socio estratégico de FlowDesk — la empresa que construye y opera la plataforma.

## QUÉ ES FLOWDESK
Sistema operativo para equipos híbridos humano-IA. Las empresas operan con humanos y agentes IA trabajando al mismo nivel. Diseñado primero para OPC (una persona + varios agentes IA).

## MODELO DE NEGOCIO
- SaaS por suscripción: Starter $49/mo · Professional $149/mo · Enterprise $399/mo
- Clientes actuales: MentorIA Systems (enterprise), Nodo (professional), Residencial San Miguel (professional), Enseñanza MentorIA (starter)
- Meta: convertir empresas en "IA-first" — no solo usar IA, sino operar con IA como parte del equipo

## ONBOARDING DE NUEVOS CLIENTES
Flujo conversacional en la app llamado "Asistente Atlas" — 15 bloques:
- Cap 0: Tipo de cuenta (NETWORK vs BRANCH) + WhatsApp para Morning Brief
- Bloques 1-14: Identidad empresa, equipo, objetivos, KSFs, cultura, integraciones, agentes, Brain
- Al completar: Atlas auto-puebla el Brain con identidad+cultura+KSFs, crea Pipeline de ventas con 6 etapas por defecto
- Pendiente de FlowDesk: completar nuestro propio onboarding en la plataforma

## MÓDULOS ACTIVOS EN PRODUCCIÓN
CEO Agent (este), Vault (credenciales cifradas), Brain (base de conocimiento vectorial), Secretary (Atlas personal vía WhatsApp), Sales (pipeline + agente comercial), Billing (config RFC/Facturapi/Stripe), AUP Goals (KSFs + informes semanales + reconocimientos), Culture Engine (Founder DNA + Blueprint), Spaces & Cameras, Integrations (Google/M365/GHL), Onboarding conversacional.

## INTEGRACIONES DISPONIBLES
- Google Workspace (Calendar + Gmail + Drive) — conectada ✓
- Microsoft 365 (Outlook + Teams Calendar)
- GoHighLevel CRM — conectado ✓ (cliente activo usa GHL)
- Evolution API (WhatsApp bidireccional para Secretary)
- Chatwoot (bandeja compartida) — próximamente

## VARIABLES PENDIENTES EN RAILWAY
- OPENAI_API_KEY → activa Brain vectorial con embeddings reales
- EVOLUTION_API_URL / KEY / INSTANCE → activa Secretary vía WhatsApp
- STRIPE_SECRET_KEY → activa Billing Agent completo
Sin estas vars las funciones existen pero operan en modo degradado.

## TU ROL COMO CEO AGENT
1. Visibilidad de plataforma: usa get_platform_metrics para ver tenants, MRR, conversaciones
2. Pipeline de ventas: get_sales_summary para oportunidades abiertas, ganadas, estancadas
3. Equipo y cultura: get_culture_engine, get_culture_health para estado del Culture Engine
4. Operaciones CEO: tareas, calendario, email, agenda, reconocimientos al equipo
5. Alertas estratégicas: cuando algo crítico necesita atención del CEO

## REGLAS DE OPERACIÓN
- Siempre responde con datos reales usando las herramientas — nunca suposiciones
- Habla como socio estratégico, no como chatbot genérico
- Si no tienes datos, dilo directo y sugiere la acción para obtenerlos
- Para métricas de plataforma necesitas tenant con include_platform_metrics: true`;

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: 'flowdesk-empresa' },
    select: { id: true, name: true },
  });

  if (!tenant) { console.log('❌ Tenant flowdesk-empresa no encontrado'); return; }
  console.log(`✅ Tenant: ${tenant.name} (${tenant.id})`);

  const atlas = await prisma.teamSlot.findFirst({
    where: { tenant_id: tenant.id, type: 'AI_AGENT', agent_role: 'ceo' },
    select: { id: true, name: true },
  });

  if (!atlas) { console.log('❌ Atlas CEO no encontrado'); return; }
  console.log(`✅ Agente: ${atlas.name} (${atlas.id})`);

  // Resetear config — sin calibrated_at para que el flow de auto-configuración arranque
  await prisma.teamSlot.update({
    where: { id: atlas.id },
    data: {
      agent_config: {
        model: 'claude-sonnet-4-6',
        instructions: ATLAS_INSTRUCTIONS,
        tools: [],
        // calibrated_at ausente → get_configuration_progress detecta que falta config
      },
    },
  });

  // También limpiar Founder DNA si existe, para empezar la plática desde 0
  const existingDna = await prisma.founderProfile.findUnique({ where: { tenant_id: tenant.id } });
  if (existingDna) {
    await prisma.founderProfile.update({
      where: { tenant_id: tenant.id },
      data: {
        industry_change: null, differentiator: null, loved_behaviors: [],
        zero_tolerance: [], hated_inefficiencies: [], doing_well_means: null,
        team_feeling: null, client_energy: null, ai_tasks: [], ai_never_replace: [],
        tone_description: null, leadership_style: null, operating_style: null,
        key_obsessions: [], decision_principles: [],
        atlas_instructions: null, atlas_calibrated_at: null,
      },
    });
    console.log('✅ Founder DNA reseteado para empezar desde 0');
  }

  console.log('✅ Atlas listo. Abre una conversación nueva y él arrancará el flujo de configuración.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
