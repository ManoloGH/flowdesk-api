import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';
import { INDUSTRY_TEMPLATES, UNIVERSAL_CAMPUS } from './onboarding.templates';
import {
  OnboardingStartDto,
  OnboardingDepartmentsDto,
  OnboardingTeamSlotsDto,
  OnboardingScheduleDto,
  OnboardingRoomsDto,
} from './dto/onboarding.dto';

const SALT_ROUNDS = 12;
const STEPS = ['company_created', 'departments_set', 'team_configured', 'schedule_set', 'rooms_set', 'launched'];

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

  // Listar templates disponibles
  getTemplates() {
    return Object.entries(INDUSTRY_TEMPLATES).map(([slug, t]) => ({
      slug,
      display_name: t.display_name,
      departments_count: t.departments.length,
      suggested_agents_count: t.suggested_agents.length,
      rooms_count: t.rooms.length,
    }));
  }

  // Estado actual del onboarding de una empresa
  async getStatus(tenantId: string) {
    const progress = await this.prisma.onboardingProgress.findFirst({
      where: { tenant_id: tenantId },
    });
    if (!progress) return { step: 0, steps_completed: [], completed: false };

    return {
      current_step: progress.current_step,
      steps_completed: progress.steps_completed,
      total_steps: STEPS.length,
      next_step: STEPS[progress.current_step] ?? null,
      completed: !!progress.completed_at,
    };
  }

  // PASO 1 — Crear empresa con template
  async start(dto: OnboardingStartDto) {
    const template = INDUSTRY_TEMPLATES[dto.template];
    if (!template) {
      throw new BadRequestException(`Template "${dto.template}" no existe. Usa: ${Object.keys(INDUSTRY_TEMPLATES).join(', ')}`);
    }

    const slugExists = await this.prisma.tenant.findFirst({ where: { slug: dto.slug } });
    if (slugExists) throw new ConflictException(`El slug "${dto.slug}" ya está en uso`);

    const emailExists = await this.prisma.teamSlot.findFirst({ where: { email: dto.owner_email } });
    if (emailExists) throw new ConflictException(`El email "${dto.owner_email}" ya está registrado`);

    const hash = await bcrypt.hash(dto.owner_password, SALT_ROUNDS);

    const result = await this.prisma.$transaction(async (tx: any) => {
      const campusEnabled = dto.campus_enabled !== false; // default true
      const tenant = await tx.tenant.create({
        data: {
          name: dto.company_name,
          slug: dto.slug,
          primary_color: dto.primary_color ?? '#4F46E5',
          plan: 'starter',
          campus_config: { campus_enabled: campusEnabled },
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

      await tx.onboardingProgress.create({
        data: {
          tenant_id: tenant.id,
          current_step: 1,
          steps_completed: ['company_created'],
          template_used: dto.template,
        },
      });

      // CEO Agent del owner con nombre por defecto — puede renombrarlo desde el Desk
      const ownerFirstName = dto.owner_name.split(' ')[0];
      const ceoInstructions =
        `Eres Atlas, el CEO Agent de ${dto.owner_name} en FlowDesk. ` +
        `Tu misión: garantizar que ${dto.owner_name} cumpla todos sus objetivos personales y empresariales. ` +
        `Eres su socio estratégico — proactivo, directo y orientado a resultados. ` +
        `Responsabilidades clave: ` +
        `(1) Revisar y priorizar tareas diariamente. ` +
        `(2) Detectar cuellos de botella y proponer soluciones concretas. ` +
        `(3) Coordinar con otros agentes del equipo para distribuir trabajo. ` +
        `(4) Proponer la creación de nuevos agentes cuando detectes una brecha. ` +
        `(5) Mantener todos los elementos del Desk en su estado óptimo. ` +
        `(6) Dar seguimiento a metas y alertar cuando haya riesgo de no cumplirlas. ` +
        `Tono: ejecutivo, conciso, motivador. Máximo 3 párrafos por respuesta salvo que se pida más detalle.`;

      await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id,
          name: 'Atlas',
          type: 'AI_AGENT',
          role: 'employee',
          status: 'ONLINE',
          agent_scope: 'personal',
          agent_role: 'ceo',
          owner_slot_id: owner.id,
          agent_config: {
            model: 'claude-sonnet-4-6',
            instructions: ceoInstructions,
            tools: [],
          },
        },
      });

      return { tenant, owner };
    });

    return {
      ...result,
      template_used: dto.template,
      template_name: template.display_name,
      next_step: 'departments',
      message: `✅ Empresa "${dto.company_name}" creada. Siguiente paso: configurar departamentos.`,
    };
  }

  // PASO 2 — Configurar departamentos (siempre arquitectura universal)
  async setupDepartments(tenantId: string, dto: OnboardingDepartmentsDto) {
    await this.validateStep(tenantId, 1);

    // Todas las empresas usan la misma estructura base
    const deptData = UNIVERSAL_CAMPUS.departments;

    const created = await this.prisma.$transaction(
      deptData.map((d: any) =>
        this.prisma.department.create({
          data: { tenant_id: tenantId, name: d.name, color: d.color ?? '#6366F1', icon: d.icon },
        }),
      ),
    );

    await this.advanceStep(tenantId, 2, 'departments_set');

    return {
      departments: created,
      next_step: 'team',
      message: `✅ ${created.length} departamentos configurados. Siguiente: añadir equipo.`,
    };
  }

  // PASO 3 — Añadir equipo (humanos + agentes)
  async setupTeam(tenantId: string, dto: OnboardingTeamSlotsDto) {
    await this.validateStep(tenantId, 2);
    const progress = await this.prisma.onboardingProgress.findFirst({ where: { tenant_id: tenantId } });
    const template = INDUSTRY_TEMPLATES[progress!.template_used!];

    // Mapa de nombre de departamento → id
    const depts = await this.prisma.department.findMany({
      where: { tenant_id: tenantId },
      select: { id: true, name: true },
    });
    const deptMap = Object.fromEntries(depts.map(d => [d.name.toLowerCase(), d.id]));

    const tempPasswords: Record<string, string> = {};
    const createdHumans: any[] = [];
    const createdAgents: any[] = [];

    // Crear humanos
    for (const h of dto.humans) {
      const exists = await this.prisma.teamSlot.findFirst({ where: { email: h.email } });
      if (exists) continue;

      const temp = this.generateTempPassword();
      tempPasswords[h.email] = temp;
      const hash = await bcrypt.hash(temp, SALT_ROUNDS);
      const deptId = h.department_name ? deptMap[h.department_name.toLowerCase()] : undefined;

      const slot = await this.prisma.teamSlot.create({
        data: {
          tenant_id: tenantId,
          name: h.name,
          email: h.email,
          password_hash: hash,
          role: h.role ?? 'employee',
          type: 'HUMAN',
          department_id: deptId,
        },
        select: { id: true, name: true, email: true, role: true },
      });
      createdHumans.push(slot);

      // El CEO Agent se crea cuando el usuario configura su perfil (ProfileSetup)
    }

    // Agentes sugeridos del template
    if (dto.add_suggested_agents && template.suggested_agents) {
      for (const a of template.suggested_agents) {
        const agent = await this.prisma.teamSlot.create({
          data: {
            tenant_id: tenantId,
            name: a.name,
            type: 'AI_AGENT',
            role: 'employee',
            status: 'ONLINE',
            agent_config: { model: 'claude-haiku-4-5-20251001', instructions: a.instructions, tools: [] },
          },
          select: { id: true, name: true, type: true },
        });
        createdAgents.push(agent);
      }
    }

    // Agentes personalizados
    for (const a of dto.custom_agents ?? []) {
      const deptId = a.department_name ? deptMap[a.department_name.toLowerCase()] : undefined;
      const agent = await this.prisma.teamSlot.create({
        data: {
          tenant_id: tenantId,
          name: a.name,
          type: 'AI_AGENT',
          role: 'employee',
          status: 'ONLINE',
          department_id: deptId,
          agent_config: {
            model: a.model ?? 'claude-haiku-4-5-20251001',
            instructions: a.instructions,
            tools: [],
          },
        },
        select: { id: true, name: true, type: true },
      });
      createdAgents.push(agent);
    }

    await this.advanceStep(tenantId, 3, 'team_configured');

    return {
      humans: createdHumans,
      agents: createdAgents,
      temp_passwords: tempPasswords,
      next_step: 'schedule',
      message: `✅ ${createdHumans.length} humanos y ${createdAgents.length} agentes añadidos. Siguiente: horario.`,
    };
  }

  // PASO 4 — Configurar horario
  async setupSchedule(tenantId: string, dto: OnboardingScheduleDto) {
    await this.validateStep(tenantId, 3);
    const progress = await this.prisma.onboardingProgress.findFirst({ where: { tenant_id: tenantId } });
    const template = INDUSTRY_TEMPLATES[progress!.template_used!];

    const scheduleData = dto.use_template ? template.schedule : dto.custom_schedule;
    if (!scheduleData) throw new BadRequestException('Debes proveer un horario personalizado');

    const schedule = await this.prisma.schedule.create({
      data: { tenant_id: tenantId, ...scheduleData },
    });

    // Asignar a todos los humanos de la empresa
    await this.prisma.teamSlot.updateMany({
      where: { tenant_id: tenantId, type: 'HUMAN' },
      data: { schedule_id: schedule.id },
    });

    await this.advanceStep(tenantId, 4, 'schedule_set');

    return {
      schedule,
      next_step: 'rooms',
      message: `✅ Horario "${schedule.name}" creado y asignado a todo el equipo. Siguiente: mapa de oficina.`,
    };
  }

  // PASO 5 — Configurar mapa de oficina (siempre arquitectura universal)
  async setupRooms(tenantId: string, dto: OnboardingRoomsDto) {
    await this.validateStep(tenantId, 4);

    // Verificar si el campus está habilitado para este tenant
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { campus_config: true },
    });
    const config = (tenant?.campus_config as any) ?? {};

    if (config.campus_enabled === false) {
      // Modo solo: saltar creación de salas pero avanzar el paso
      await this.advanceStep(tenantId, 5, 'rooms_set');
      return {
        rooms: [],
        campus_enabled: false,
        next_step: 'launch',
        message: '✅ Modo solo: campus desactivado. Listo para activar.',
      };
    }

    // Todas las empresas con campus usan el mismo mapa base
    const roomsData = UNIVERSAL_CAMPUS.rooms;

    const created = await this.prisma.$transaction(
      roomsData.map((r: any) =>
        this.prisma.room.create({
          data: { tenant_id: tenantId, ...r, color: r.color ?? '#1E1E2E' },
        }),
      ),
    );

    await this.advanceStep(tenantId, 5, 'rooms_set');

    return {
      rooms: created,
      campus_enabled: true,
      next_step: 'launch',
      message: `✅ ${created.length} salas configuradas. Listo para activar la empresa.`,
    };
  }

  // PASO 6 — Activar la empresa
  async launch(tenantId: string) {
    await this.validateStep(tenantId, 5);

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'active' },
    });

    await this.prisma.onboardingProgress.update({
      where: { tenant_id: tenantId },
      data: {
        current_step: 6,
        steps_completed: STEPS,
        completed_at: new Date(),
      },
    });

    const stats = await this.getCompanyStats(tenantId);

    return {
      launched: true,
      stats,
      message: `🚀 ¡FlowDesk activado! La empresa está lista. Los empleados ya pueden hacer login.`,
    };
  }

  // ─── Helpers internos ────────────────────────────────────────────────────────

  private async validateStep(tenantId: string, expectedStep: number) {
    const progress = await this.prisma.onboardingProgress.findFirst({ where: { tenant_id: tenantId } });
    if (!progress) throw new BadRequestException('Onboarding no iniciado. Ejecuta POST /onboarding/start primero.');
    if (progress.current_step < expectedStep) {
      throw new BadRequestException(`Debes completar el paso ${expectedStep} antes. Paso actual: ${progress.current_step}`);
    }
  }

  private advanceStep(tenantId: string, step: number, stepName: string) {
    return this.prisma.onboardingProgress.update({
      where: { tenant_id: tenantId },
      data: {
        current_step: step,
        steps_completed: STEPS.slice(0, step),
      },
    });
  }

  private async getCompanyStats(tenantId: string) {
    const [humans, agents, departments, rooms] = await Promise.all([
      this.prisma.teamSlot.count({ where: { tenant_id: tenantId, type: 'HUMAN' } }),
      this.prisma.teamSlot.count({ where: { tenant_id: tenantId, type: 'AI_AGENT' } }),
      this.prisma.department.count({ where: { tenant_id: tenantId } }),
      this.prisma.room.count({ where: { tenant_id: tenantId } }),
    ]);
    return { humans, agents, departments, rooms };
  }

  private async createPersonalAgents(tenantId: string, humanSlotId: string, humanName: string, agentsArray: any[]) {
    const personalAgents = [
      {
        name: `Agente Enfoque — ${humanName}`,
        agent_role: 'focus_agent',
        instructions: `Eres el agente de enfoque personal de ${humanName}. Tu misión es ayudarle a priorizar tareas, mantener el foco en sus objetivos y gestionar su tiempo de manera efectiva. Conoces sus metas, pendientes y progreso diario.`,
      },
      {
        name: `Asistente Diario — ${humanName}`,
        agent_role: 'daily_assistant',
        instructions: `Eres el asistente de jornada de ${humanName}. Te encargas de organizar su día, recordarle pendientes, coordinar su agenda y facilitar comunicaciones. Eres su mano derecha operativa en FlowDesk.`,
      },
    ];

    for (const a of personalAgents) {
      const agent = await this.prisma.teamSlot.create({
        data: {
          tenant_id: tenantId,
          name: a.name,
          type: 'AI_AGENT',
          role: 'employee',
          status: 'ONLINE',
          agent_scope: 'personal',
          agent_role: a.agent_role,
          owner_slot_id: humanSlotId,
          agent_config: {
            model: 'claude-haiku-4-5-20251001',
            instructions: a.instructions,
            tools: [],
          },
        },
        select: { id: true, name: true, type: true, agent_role: true, owner_slot_id: true },
      });
      agentsArray.push(agent);
    }
  }

  private generateTempPassword(): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@$!';
    return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
}
