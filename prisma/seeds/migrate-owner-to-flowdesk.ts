/**
 * Migración: mover manolo.gho@gmail.com al tenant flowdesk-empresa
 *
 * 1. Actualiza el slot superadmin del PLATFORM a admin@flowdesk.mx (mantiene hash)
 * 2. Crea slot owner en flowdesk-empresa con manolo.gho@gmail.com (mismo hash)
 * 3. Actualiza campus_config del tenant flowdesk-empresa con metadata de negocio
 *
 * Uso:
 *   npx ts-node prisma/seeds/migrate-owner-to-flowdesk.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const OWNER_EMAIL     = 'manolo.gho@gmail.com';
const ADMIN_EMAIL     = 'admin@flowdesk.mx';
const EMPRESA_SLUG    = 'flowdesk-empresa';
const PLATFORM_SLUG   = 'flowdesk';

async function main() {
  console.log('\n🚀 Migración: owner → flowdesk-empresa\n');

  // 1. Obtener tenant PLATFORM y el slot superadmin
  const platform = await prisma.tenant.findUnique({ where: { slug: PLATFORM_SLUG } });
  if (!platform) throw new Error(`Tenant "${PLATFORM_SLUG}" no encontrado`);
  console.log(`✅ PLATFORM: ${platform.id}`);

  const superadminSlot = await prisma.teamSlot.findFirst({
    where: { tenant_id: platform.id, email: OWNER_EMAIL },
  });
  if (!superadminSlot) throw new Error(`Slot con email ${OWNER_EMAIL} no encontrado en PLATFORM`);
  console.log(`✅ Slot superadmin: ${superadminSlot.id} (${superadminSlot.email})`);

  // Guardar el hash de password para reutilizarlo
  const passwordHash = superadminSlot.password_hash;

  // 2. Cambiar email del superadmin a admin@flowdesk.mx
  const existingAdmin = await prisma.teamSlot.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existingAdmin) {
    console.log(`ℹ️  ${ADMIN_EMAIL} ya existe — saltando cambio de email`);
  } else {
    await prisma.teamSlot.update({
      where: { id: superadminSlot.id },
      data: { email: ADMIN_EMAIL },
    });
    console.log(`✅ Email superadmin cambiado: ${OWNER_EMAIL} → ${ADMIN_EMAIL}`);
  }

  // 3. Obtener tenant flowdesk-empresa
  const empresa = await prisma.tenant.findUnique({ where: { slug: EMPRESA_SLUG } });
  if (!empresa) throw new Error(`Tenant "${EMPRESA_SLUG}" no encontrado — ejecuta setup-tenants.ts primero`);
  console.log(`✅ Tenant empresa: ${empresa.id}`);

  // 4. Crear slot owner en flowdesk-empresa con el mismo email y password
  const existingOwner = await prisma.teamSlot.findFirst({
    where: { tenant_id: empresa.id, role: 'owner', type: 'HUMAN' },
  });

  let ownerSlotId: string;

  if (existingOwner) {
    console.log(`ℹ️  Owner ya existe en flowdesk-empresa: ${existingOwner.id}`);
    // Actualizar email si es distinto
    if (existingOwner.email !== OWNER_EMAIL) {
      await prisma.teamSlot.update({
        where: { id: existingOwner.id },
        data: { email: OWNER_EMAIL, password_hash: passwordHash },
      });
      console.log(`✅ Email owner actualizado a ${OWNER_EMAIL}`);
    }
    ownerSlotId = existingOwner.id;
  } else {
    const newOwner = await prisma.teamSlot.create({
      data: {
        tenant_id:     empresa.id,
        name:          'CEO FlowDesk',
        email:         OWNER_EMAIL,
        password_hash: passwordHash,
        type:          'HUMAN',
        role:          'owner',
        status:        'OFFLINE',
        desk_access:   'FULL',
      },
    });
    ownerSlotId = newOwner.id;
    console.log(`✅ Owner creado en flowdesk-empresa: ${ownerSlotId}`);
  }

  // 5. Actualizar campus_config de flowdesk-empresa con metadata de negocio
  const currentCfg = (empresa.campus_config as Record<string, unknown>) ?? {};
  await prisma.tenant.update({
    where: { id: empresa.id },
    data: {
      campus_config: {
        ...currentCfg,
        account_type:   'SAAS_ACCOUNT',
        negocio_tipo:   'plataforma_saas',
        kpis_focus:     ['tenants_activos', 'mrr_usd', 'adoption_rate', 'churn_rate', 'nps'],
        include_platform_metrics: true,    // CEO Agent tendrá acceso a métricas de plataforma
      },
    },
  });
  console.log(`✅ campus_config actualizado con metadata de negocio`);

  // 6. Asociar los agentes IA existentes al nuevo owner
  const agents = await prisma.teamSlot.findMany({
    where: { tenant_id: empresa.id, type: 'AI_AGENT', owner_slot_id: null },
  });
  if (agents.length > 0) {
    await prisma.teamSlot.updateMany({
      where: { tenant_id: empresa.id, type: 'AI_AGENT', owner_slot_id: null },
      data: { owner_slot_id: ownerSlotId },
    });
    console.log(`✅ ${agents.length} agente(s) asociados al owner`);
  }

  // 7. Marcar onboarding como completado para no mostrar wizard
  const progress = await prisma.onboardingProgress.findUnique({ where: { tenant_id: empresa.id } });
  if (!progress) {
    await prisma.onboardingProgress.create({
      data: {
        tenant_id:       empresa.id,
        current_step:    6,
        steps_completed: ['company_created', 'departments_set', 'team_configured', 'schedule_set', 'rooms_set', 'launched'],
        template_used:   'saas',
        completed_at:    new Date(),
      },
    });
    console.log(`✅ Onboarding marcado como completado`);
  }

  console.log(`
╔══════════════════════════════════════════════════════╗
║  Migración completada                                ║
╠══════════════════════════════════════════════════════╣
║  Superadmin técnico : admin@flowdesk.mx              ║
║  FlowDesk empresa   : manolo.gho@gmail.com           ║
║  Password           : la misma de siempre            ║
╠══════════════════════════════════════════════════════╣
║  Siguiente: login con manolo.gho@gmail.com           ║
║  → entrará directamente a FlowDesk empresa           ║
╚══════════════════════════════════════════════════════╝
`);
}

main()
  .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
