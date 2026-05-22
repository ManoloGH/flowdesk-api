/**
 * Actualiza el Founder DNA de MentorIA con las respuestas del founder
 * y calibra a CEO Digital con el perfil completo.
 *
 * Uso: npx ts-node prisma/seeds/calibrate-mentoria.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function main() {
  console.log('🧬 Actualizando Founder DNA de MentorIA...\n');

  const tenant = await prisma.tenant.findFirst({ where: { slug: 'mentoria' } });
  if (!tenant) throw new Error('Tenant mentoria no encontrado');

  const owner = await prisma.teamSlot.findFirst({
    where: { tenant_id: tenant.id, role: 'owner', type: 'HUMAN' },
    select: { id: true, name: true },
  });
  if (!owner) throw new Error('Owner slot no encontrado');

  // ── 1. Actualizar Founder DNA con las respuestas reales ──────────────────

  await prisma.founderProfile.upsert({
    where: { tenant_id: tenant.id },
    create: {
      tenant_id: tenant.id,
      slot_id:   owner.id,
    },
    update: {
      // Lo que más le desespera de cómo operan las empresas
      hated_inefficiencies: [
        'Que el negocio dependa de una sola persona para operar — si esa persona no está, todo se detiene',
        'Pagar herramientas de IA sin saber operarlas — el problema no es el acceso, es que nadie las activa',
        'Contratar antes de automatizar — la primera respuesta siempre es "voy a contratar" en lugar de construir el sistema',
        'Onboarding manual que depende de un técnico específico',
        'Información dispersa en múltiples herramientas sin sincronización',
        'Contenido producido que nunca se publica',
      ],
      // Lo que quiere cambiar en las empresas (scope global, no solo PYMEs/LATAM)
      industry_change:
        'Las empresas — de cualquier tamaño y geografía — no tienen por qué depender de una sola persona o de un equipo costoso ' +
        'para operar. La IA ya existe para hacer ese trabajo. Lo que falta no es tecnología: es quien la active y la mantenga funcionando. ' +
        'MentorIA es esa pieza que falta.',
      // Qué emoción quiere que sienta el cliente
      client_energy:
        'Orgullo — tener algo que pocos negocios tienen. La sensación de estar en ventaja real frente a su competencia, ' +
        'con un equipo de agentes que trabajan sin que él tenga que estar presente.',
      // Señal de éxito este trimestre
      doing_well_means:
        'Onboarding de 5 clientes en una semana sin una sola intervención manual del equipo. ' +
        'El sistema provisiona, configura, notifica y entrega sin que el Founder tenga que tocar nada. ' +
        'Eso significa que MentorIA ya no es una agencia — es una plataforma.',
    },
  });

  console.log('   ✅ Founder DNA actualizado con las respuestas del founder\n');

  // ── 2. Generar instrucciones personalizadas para CEO Digital ───────────────────

  console.log('🤖 Calibrando CEO Digital con el Founder DNA completo...\n');

  const profile = await prisma.founderProfile.findUnique({ where: { tenant_id: tenant.id } });
  if (!profile) throw new Error('Founder profile no encontrado');

  const prompt = `Eres un experto en diseño de agentes IA corporativos.
Tu tarea es generar las instrucciones del sistema para un CEO Agent (CEO Digital) ultra-personalizado para un fundador específico.
El agente debe sonar y pensar EXACTAMENTE como ese fundador se lo imagina.

INFORMACIÓN DEL FUNDADOR:
Empresa: MentorIA Systems
Founder: ${owner.name}
Tagline: "inteligencia humana, potencia artificial"

MISIÓN: Dar a las empresas acceso a departamentos completos de agentes IA que trabajen junto a sus equipos humanos.
VISIÓN: Ser la infraestructura de agentes más usada por empresas que quieren operar sin depender de una sola persona.

LO QUE QUIERE CAMBIAR EN LAS EMPRESAS: ${profile.industry_change}
LO QUE HACE DIFERENTE A MENTORIA (NÚCLEO DE IDENTIDAD): ${profile.differentiator}
FRASE QUE JAMÁS DIRÍA: "Somos un sistema genérico" — la hiperpersonalización es la promesa central. Cada cliente termina con un sistema que opera y suena como su empresa específica, nunca como un template de catálogo.
LO QUE MÁS LE DESESPERA: ${JSON.stringify(profile.hated_inefficiencies)}
LO QUE SIGNIFICA HACERLO BIEN: ${profile.doing_well_means}
CÓMO QUIERE QUE SE SIENTA EL EQUIPO: ${profile.team_feeling}
ENERGÍA QUE QUIERE TRANSMITIR AL CLIENTE: ${profile.client_energy}

COMPORTAMIENTOS QUE AMA: ${JSON.stringify(profile.loved_behaviors)}
LO QUE JAMÁS TOLERARÍA: ${JSON.stringify(profile.zero_tolerance)}

LO QUE SÍ DEBE HACER LA IA: ${JSON.stringify(profile.ai_tasks)}
LO QUE JAMÁS REEMPLAZARÍA LA IA: ${JSON.stringify(profile.ai_never_replace)}

ESTILO DE LIDERAZGO: ${profile.leadership_style}
ESTILO OPERATIVO: ${profile.operating_style}
OBSESIONES CLAVE: ${JSON.stringify(profile.key_obsessions)}
PRINCIPIOS DE DECISIÓN: ${JSON.stringify(profile.decision_principles)}

CONTEXTO OPERATIVO CRÍTICO:
• Clientes activos: Huesana, Integra (Tipo B), Soc (Tipo A)
• Stack interno: n8n, Evolution API, Airtable, Softr, Canva Teams, Google Drive, FlowDesk
• MentorIA ES su primer cliente (dogfooding) — FlowDesk es la operación interna
• Regla de oro: ningún contenido llega al cliente sin aprobación del Director Creativo
• KPI de éxito: onboarding de un cliente nuevo en < 24h sin intervención manual

Genera las instrucciones del sistema para CEO Digital (CEO Agent). Deben:
1. Comenzar con la identidad del agente y su misión específica con este fundador
2. Incorporar la filosofía operativa del fundador como guía de comportamiento del agente
3. Incluir qué comportamientos debe reforzar y cuáles señalar cuando los detecte
4. Definir el tono y energía de sus respuestas alineado con la cultura de MentorIA
5. Especificar cómo manejar la relación humano-IA según los valores del fundador
6. Incluir los KPIs que debe monitorear proactivamente
7. Definir cuándo intervenir autónomamente vs cuándo escalar al founder

Tono: ejecutivo, directo, orientado a resultados. Sin rodeos. Máximo 500 palabras.
Responde solo las instrucciones, en español.`;

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1200,
    messages:   [{ role: 'user', content: prompt }],
  });

  const instructions = response.content[0]?.type === 'text' ? response.content[0].text : null;
  if (!instructions) throw new Error('No se pudo generar instrucciones para CEO Digital');

  // Guardar instrucciones en el perfil del fundador
  await prisma.founderProfile.update({
    where: { tenant_id: tenant.id },
    data:  { atlas_instructions: instructions, atlas_calibrated_at: new Date() },
  });

  // Actualizar el CEO Agent (CEO Digital) con las nuevas instrucciones
  const atlasAgent = await prisma.teamSlot.findFirst({
    where: { tenant_id: tenant.id, agent_role: 'ceo', type: 'AI_AGENT' },
  });

  if (atlasAgent) {
    const currentConfig = (atlasAgent.agent_config as any) ?? {};
    await prisma.teamSlot.update({
      where: { id: atlasAgent.id },
      data:  { agent_config: { ...currentConfig, instructions } },
    });
    console.log('   ✅ Instrucciones de CEO Digital actualizadas en la BD\n');
  }

  console.log('─── Instrucciones generadas para CEO Digital ────────────────────────');
  console.log(instructions);
  console.log('───────────────────────────────────────────────────────────────\n');

  console.log(`✅ Calibración completada.
   · Founder DNA: actualizado con respuestas reales
   · CEO Digital: instrucciones personalizadas generadas y guardadas
   · Siguiente paso: agregar más muestras de comunicación con CEO Digital
     (WhatsApps, emails, propuestas) para subir la calibración de voz a "high"
`);
}

main()
  .catch(e => { console.error('❌ Error en calibración:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
