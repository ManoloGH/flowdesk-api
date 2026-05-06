import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto, UpdateTenantStatusDto, UpdateTenantTypeDto } from './dto/update-tenant.dto';

const SALT_ROUNDS = 12;

// Campos que devuelve una empresa sin datos sensibles
const TENANT_SELECT = {
  id: true,
  name: true,
  slug: true,
  logo_url: true,
  primary_color: true,
  plan: true,
  status: true,
  created_at: true,
  _count: { select: { team_slots: true, departments: true } },
};

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  // Super-admin: ver todas las empresas con owner y stats
  async findAll() {
    return this.prisma.tenant.findMany({
      select: {
        ...TENANT_SELECT,
        tier: true,
        max_humans: true,
        max_agents: true,
        updated_at: true,
        team_slots: {
          where: { role: 'owner', type: 'HUMAN' },
          select: { id: true, name: true, email: true },
          take: 1,
        },
        _count: { select: { team_slots: true, departments: true, contacts: true } },
      },
      where: { slug: { not: 'flowdesk' } }, // excluir tenant interno
      orderBy: { created_at: 'desc' },
    });
  }

  // Cualquier usuario: ver su propia empresa
  async findMine(tenantId: string) {
    return this.findOneOrFail(tenantId);
  }

  async findOne(id: string, requestingTenantId: string, requestingRole: string) {
    // Solo super-admin puede ver otras empresas
    if (id !== requestingTenantId && requestingRole !== 'superadmin') {
      throw new ForbiddenException('Solo puedes ver tu propia empresa');
    }
    return this.findOneOrFail(id);
  }

  // Super-admin: crear empresa + owner en una transacción
  async create(dto: CreateTenantDto) {
    const slugExists = await this.prisma.tenant.findFirst({ where: { slug: dto.slug } });
    if (slugExists) throw new ConflictException(`El slug "${dto.slug}" ya está en uso`);

    const emailExists = await this.prisma.teamSlot.findFirst({ where: { email: dto.owner_email } });
    if (emailExists) throw new ConflictException(`El email "${dto.owner_email}" ya está registrado`);

    const hash = await bcrypt.hash(dto.owner_password, SALT_ROUNDS);

    return this.prisma.$transaction(async (tx: any) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          plan: dto.plan ?? 'starter',
          primary_color: dto.primary_color ?? '#4F46E5',
          logo_url: dto.logo_url,
        },
      });

      const owner = await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id,
          name: dto.owner_name,
          email: dto.owner_email,
          password_hash: hash,
          role: 'owner',
          type: 'HUMAN',
        },
        select: { id: true, name: true, email: true, role: true },
      });

      // Progreso de onboarding inicial
      await tx.onboardingProgress.create({
        data: {
          tenant_id: tenant.id,
          current_step: 1,
          steps_completed: ['company_created'],
          template_used: null,
        },
      });

      return { tenant, owner };
    });
  }

  // Owner/admin: actualizar datos de su empresa
  async update(id: string, dto: UpdateTenantDto, requestingTenantId: string, requestingRole: string) {
    this.assertOwnership(id, requestingTenantId, requestingRole);
    await this.findOneOrFail(id);

    return this.prisma.tenant.update({
      where: { id },
      data: dto,
      select: TENANT_SELECT,
    });
  }

  // Super-admin: cambiar status de empresa
  async updateStatus(id: string, dto: UpdateTenantStatusDto) {
    await this.findOneOrFail(id);
    return this.prisma.tenant.update({
      where: { id },
      data: { status: dto.status },
      select: { id: true, name: true, status: true },
    });
  }

  // Super-admin: cambiar tipo de tenant (PLATFORM / NETWORK / BRANCH)
  async updateType(id: string, dto: UpdateTenantTypeDto) {
    await this.findOneOrFail(id);
    return this.prisma.tenant.update({
      where: { id },
      data: {
        tenant_type: dto.tenant_type as any,
        network_id: dto.network_id ?? undefined,
      },
      select: { id: true, name: true, tenant_type: true, network_id: true },
    });
  }

  // Super-admin: eliminar empresa y todos sus datos (cascade)
  async remove(id: string) {
    await this.findOneOrFail(id);
    await this.prisma.tenant.delete({ where: { id } });
    return { message: `Empresa eliminada correctamente` };
  }

  // ─── Super-admin: slots, contraseñas, integraciones ─────────────────────────

  async listTenantSlots(tenantId: string) {
    await this.findOneOrFail(tenantId);
    return this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, type: 'HUMAN' },
      select: { id: true, name: true, email: true, role: true, status: true, avatar_url: true, created_at: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async resetSlotPassword(tenantId: string, slotId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: slotId, tenant_id: tenantId, type: 'HUMAN' },
      select: { id: true, name: true, email: true },
    });
    if (!slot) throw new NotFoundException('Usuario no encontrado');

    const newPassword = this.generatePassword();
    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.teamSlot.update({ where: { id: slotId }, data: { password_hash: hash } });

    return { slot_id: slotId, name: slot.name, email: slot.email ?? '', new_password: newPassword };
  }

  private generatePassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const special = '!@#$%&*';
    const all = upper + lower + digits + special;
    const rand = (s: string) => s[Math.floor((crypto.randomBytes(1)[0] / 256) * s.length)];
    let p = rand(upper) + rand(lower) + rand(digits) + rand(special);
    for (let i = 4; i < 14; i++) p += rand(all);
    return p.split('').sort(() => crypto.randomBytes(1)[0] - 128).join('');
  }

  async listTenantIntegrations(tenantId: string) {
    await this.findOneOrFail(tenantId);
    return this.prisma.integration.findMany({
      where: { tenant_id: tenantId },
      select: {
        id: true, provider: true, status: true,
        integration_scope: true, connected_at: true, last_sync_at: true, created_at: true,
        config: true,
        owner_slot: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ provider: 'asc' }],
    });
  }

  // ─── Export / Restore ────────────────────────────────────────────────────────

  async exportTenant(id: string) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id } });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');

    const slotSelect = {
      id: true, tenant_id: true, department_id: true, name: true, type: true,
      role: true, avatar_url: true, avatar_config: true, status: true,
      position_x: true, position_y: true, email: true, schedule_id: true,
      desk_config: true, desk_access: true, agent_config: true,
      agent_scope: true, agent_role: true, owner_slot_id: true,
      permissions: true, created_at: true, updated_at: true,
      // Excluidos por seguridad: password_hash, access_token
    };

    const integrationSelect = {
      id: true, tenant_id: true, owner_slot_id: true, dept_id: true,
      integration_scope: true, provider: true, status: true, scope: true,
      config: true, last_sync_at: true, connected_at: true,
      created_at: true, updated_at: true,
      // Excluido: credentials_enc (tokens OAuth)
    };

    const [
      slots, departments, schedules, tasks, goals, contacts,
      meetings, conversations, memories, integrations, onboarding, mapProps,
    ] = await Promise.all([
      this.prisma.teamSlot.findMany({ where: { tenant_id: id }, select: slotSelect }),
      this.prisma.department.findMany({ where: { tenant_id: id } }),
      this.prisma.schedule.findMany({ where: { tenant_id: id } }),
      this.prisma.task.findMany({ where: { tenant_id: id } }),
      this.prisma.goal.findMany({ where: { tenant_id: id } }),
      this.prisma.contact.findMany({ where: { tenant_id: id } }),
      this.prisma.meeting.findMany({ where: { tenant_id: id } }),
      this.prisma.agentConversation.findMany({
        where: { tenant_id: id },
        include: { messages: { orderBy: { created_at: 'asc' } } },
      }),
      this.prisma.agentMemory.findMany({ where: { tenant_id: id } }),
      this.prisma.integration.findMany({ where: { tenant_id: id }, select: integrationSelect }),
      this.prisma.onboardingProgress.findFirst({ where: { tenant_id: id } }),
      this.prisma.mapProp.findMany({ where: { tenant_id: id } }),
    ]);

    return {
      export_version: '1',
      exported_at: new Date().toISOString(),
      tenant,
      data: {
        slots, departments, schedules, tasks, goals, contacts,
        meetings, agent_conversations: conversations,
        agent_memories: memories, integrations, onboarding, map_props: mapProps,
      },
    };
  }

  async restoreTenant(id: string, exportData: any) {
    if (!exportData?.export_version || !exportData?.tenant?.id) {
      throw new BadRequestException('Formato de export inválido. Usa un archivo generado por GET /tenants/:id/export');
    }
    if (exportData.tenant.id !== id) {
      throw new BadRequestException(`El export pertenece al tenant "${exportData.tenant.id}", no "${id}"`);
    }

    const tenant = await this.prisma.tenant.findFirst({ where: { id } });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');

    const { data } = exportData;
    const summary: Record<string, number> = {};
    const PLACEHOLDER_HASH = '$2b$12$placeholder.must.reset.password.xxxxxxxxxxxxxxxxxxxxxxxx';

    // 1. Schedules (antes que slots — slots referencian schedule_id)
    if (data.schedules?.length) {
      const r = await this.prisma.schedule.createMany({ data: data.schedules, skipDuplicates: true });
      summary.schedules = r.count;
    }

    // 2. Departments (antes que slots — slots referencian department_id)
    if (data.departments?.length) {
      // Restaurar primero los padres (parent_id null), luego los hijos
      const roots = data.departments.filter((d: any) => !d.parent_id);
      const children = data.departments.filter((d: any) => d.parent_id);
      if (roots.length) await this.prisma.department.createMany({ data: roots, skipDuplicates: true });
      if (children.length) await this.prisma.department.createMany({ data: children, skipDuplicates: true });
      summary.departments = roots.length + children.length;
    }

    // 3. TeamSlots — sin password (quedan bloqueados hasta reset)
    if (data.slots?.length) {
      const r = await this.prisma.teamSlot.createMany({
        data: data.slots.map((s: any) => ({
          ...s,
          password_hash: PLACEHOLDER_HASH,
          access_token: null, // regenerar en próximo login LIGHT
        })),
        skipDuplicates: true,
      });
      summary.team_slots = r.count;
    }

    // 4. Datos de productividad (paralelo — no tienen dependencias entre sí)
    const [tasks, goals, contacts, meetings] = await Promise.all([
      data.tasks?.length
        ? this.prisma.task.createMany({ data: data.tasks, skipDuplicates: true })
        : { count: 0 },
      data.goals?.length
        ? this.prisma.goal.createMany({ data: data.goals, skipDuplicates: true })
        : { count: 0 },
      data.contacts?.length
        ? this.prisma.contact.createMany({ data: data.contacts, skipDuplicates: true })
        : { count: 0 },
      data.meetings?.length
        ? this.prisma.meeting.createMany({ data: data.meetings, skipDuplicates: true })
        : { count: 0 },
    ]);
    summary.tasks = tasks.count;
    summary.goals = goals.count;
    summary.contacts = contacts.count;
    summary.meetings = meetings.count;

    // 5. Conversaciones de agentes + mensajes
    if (data.agent_conversations?.length) {
      const convData = data.agent_conversations.map(({ messages: _m, ...c }: any) => c);
      const convResult = await this.prisma.agentConversation.createMany({
        data: convData,
        skipDuplicates: true,
      });
      summary.agent_conversations = convResult.count;

      const allMessages = data.agent_conversations.flatMap((c: any) => c.messages ?? []);
      if (allMessages.length) {
        const msgResult = await this.prisma.agentMessage.createMany({
          data: allMessages,
          skipDuplicates: true,
        });
        summary.agent_messages = msgResult.count;
      }
    }

    // 6. Memorias de agentes
    if (data.agent_memories?.length) {
      const r = await this.prisma.agentMemory.createMany({ data: data.agent_memories, skipDuplicates: true });
      summary.agent_memories = r.count;
    }

    // 7. Map props
    if (data.map_props?.length) {
      const r = await this.prisma.mapProp.createMany({ data: data.map_props, skipDuplicates: true });
      summary.map_props = r.count;
    }

    // 8. Integraciones (sin credentials — el usuario deberá reconectar OAuth)
    if (data.integrations?.length) {
      const r = await this.prisma.integration.createMany({
        data: data.integrations.map((i: any) => ({ ...i, credentials_enc: null, status: 'disconnected' })),
        skipDuplicates: true,
      });
      summary.integrations = r.count;
    }

    const restoredSlots = summary.team_slots ?? 0;
    return {
      tenant_id: id,
      restored_at: new Date().toISOString(),
      summary,
      warnings: [
        ...(restoredSlots > 0
          ? [`${restoredSlots} usuario(s) restaurado(s) sin contraseña — envía links de restablecimiento.`]
          : []),
        ...(summary.integrations
          ? ['Las integraciones OAuth (Google, Microsoft) deben reconectarse manualmente en Configuración → Integraciones.']
          : []),
      ],
    };
  }

  // Consumo de tokens IA del mes actual
  async tokenUsage(tenantId: string) {
    const PLAN_LIMITS: Record<string, number> = {
      starter: 500_000,
      professional: 2_000_000,
      enterprise: 10_000_000,
    };
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [tenant, agg] = await Promise.all([
      this.prisma.tenant.findFirst({ where: { id: tenantId }, select: { plan: true } }),
      this.prisma.agentMessage.aggregate({
        where: {
          conversation: { tenant_id: tenantId },
          created_at: { gte: monthStart },
          tokens_used: { not: null },
        },
        _sum: { tokens_used: true },
      }),
    ]);

    const used = agg._sum.tokens_used ?? 0;
    const plan = tenant?.plan ?? 'starter';
    const limit = PLAN_LIMITS[plan] ?? 500_000;

    return {
      period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      tokens_used: used,
      tokens_limit: limit,
      usage_percent: Math.round((used / limit) * 100),
      plan,
    };
  }

  // Stats de una empresa para el dashboard del dueño
  async stats(tenantId: string) {
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [humans, agents, onlineSlots, departments, contacts, tasksPending, upcomingEvents, pendingOnboarding] =
      await Promise.all([
        this.prisma.teamSlot.count({ where: { tenant_id: tenantId, type: 'HUMAN' } }),
        this.prisma.teamSlot.count({ where: { tenant_id: tenantId, type: 'AI_AGENT' } }),
        this.prisma.teamSlot.count({ where: { tenant_id: tenantId, status: { in: ['ONLINE', 'BUSY'] as any } } }),
        this.prisma.department.count({ where: { tenant_id: tenantId } }),
        this.prisma.contact.count({ where: { tenant_id: tenantId } }),
        this.prisma.task.count({ where: { tenant_id: tenantId, status: { in: ['pending', 'in_progress'] } } }),
        this.prisma.calendarEvent.findMany({
          where: { tenant_id: tenantId, start_at: { gte: now, lte: weekAhead } },
          select: { id: true, title: true, start_at: true, end_at: true, location: true },
          orderBy: { start_at: 'asc' },
          take: 5,
        }),
        this.prisma.onboardingProgress.findFirst({
          where: { tenant_id: tenantId, completed_at: null },
          select: { current_step: true, steps_completed: true },
        }),
      ]);

    return {
      humans,
      agents,
      onlineSlots,
      departments,
      contacts,
      tasks_pending: tasksPending,
      upcoming_events: upcomingEvents,
      onboarding: pendingOnboarding,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async findOneOrFail(id: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id },
      select: TENANT_SELECT,
    });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');
    return tenant;
  }

  private assertOwnership(targetId: string, requestingId: string, role: string) {
    if (targetId !== requestingId && role !== 'superadmin') {
      throw new ForbiddenException('Solo puedes modificar tu propia empresa');
    }
  }
}
