import Anthropic from '@anthropic-ai/sdk';
import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';
import { AirtableService } from '../airtable/airtable.service';
import { KsfService } from '../goals/services/ksf.service';
import { CultureService } from '../culture/culture.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { INDUSTRY_TEMPLATES, UNIVERSAL_CAMPUS, DEFAULT_OWNER_DESK, MENTORIA_OWNER_DESK } from './onboarding.templates';
import {
  OnboardingStartDto,
  OnboardingDepartmentsDto,
  OnboardingTeamSlotsDto,
  OnboardingScheduleDto,
  OnboardingRoomsDto,
} from './dto/onboarding.dto';
import { KsfLevel, KsfCategory, KsfOrigin, MeasurementSource, MeasurementFrequency } from '@prisma/client';

const SALT_ROUNDS = 12;
const STEPS = ['company_created', 'departments_set', 'team_configured', 'schedule_set', 'rooms_set', 'launched'];

@Injectable()
export class OnboardingService {
  constructor(
    private prisma: PrismaService,
    private airtable: AirtableService,
    private ksf: KsfService,
    private culture: CultureService,
    private integrations: IntegrationsService,
  ) {}

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
      const adn = (template as any).adn ?? {};
      const tenant = await tx.tenant.create({
        data: {
          name:            dto.company_name,
          slug:            dto.slug,
          primary_color:   dto.primary_color ?? adn.primary_color ?? '#4F46E5',
          secondary_color: adn.secondary_color ?? null,
          tagline:         dto.tagline ?? adn.tagline ?? null,
          industry:        dto.industry ?? adn.industry ?? null,
          mission:         dto.mission ?? adn.mission ?? null,
          vision:          dto.vision ?? adn.vision ?? null,
          plan:            'starter',
          campus_config:   { campus_enabled: campusEnabled },
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
      const missionLine = adn.mission
        ? `\n\nMISIÓN DE LA EMPRESA: ${adn.mission}`
        : '';
      const taglineLine = adn.tagline
        ? `\n\nTAGLINE: "${adn.tagline}"`
        : '';
      const ceoInstructions =
        `Eres Atlas, el CEO Agent de ${dto.owner_name} en FlowDesk.${taglineLine}${missionLine}\n\n` +
        `Tu misión: garantizar que ${ownerFirstName} cumpla todos sus objetivos personales y empresariales. ` +
        `Eres su socio estratégico — proactivo, directo y orientado a resultados.\n\n` +
        `Responsabilidades clave:\n` +
        `(1) Revisar y priorizar tareas diariamente.\n` +
        `(2) Detectar cuellos de botella y proponer soluciones concretas.\n` +
        `(3) Coordinar con otros agentes del equipo para distribuir trabajo.\n` +
        `(4) Proponer la creación de nuevos agentes cuando detectes una brecha.\n` +
        `(5) Mantener todos los elementos del Desk en su estado óptimo.\n` +
        `(6) Dar seguimiento a metas AUP y alertar cuando haya riesgo de no cumplirlas.\n\n` +
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

  // PASO 5 — Configurar mapa de oficina (generado a partir de departamentos reales)
  async setupRooms(tenantId: string, dto: OnboardingRoomsDto) {
    await this.validateStep(tenantId, 4);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { campus_config: true },
    });
    const config = (tenant?.campus_config as any) ?? {};

    if (config.campus_enabled === false) {
      await this.advanceStep(tenantId, 5, 'rooms_set');
      return {
        rooms: [],
        campus_enabled: false,
        next_step: 'launch',
        message: '✅ Modo solo: campus desactivado. Listo para activar.',
      };
    }

    const departments = await this.prisma.department.findMany({
      where: { tenant_id: tenantId },
      select: { name: true, color: true },
    });

    const roomsData = this.buildRoomsFromDepartments(departments);

    const created = await this.prisma.$transaction(
      roomsData.map((r: any) =>
        this.prisma.room.create({
          data: { tenant_id: tenantId, ...r },
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

  // Genera el layout del campus a partir de los departamentos declarados.
  // Reglas: Sala de Juntas siempre primero. Marketing Digital se fusiona con Ventas.
  // ≤3 departamentos → espacio abierto único. >3 → una sala por departamento.
  private buildRoomsFromDepartments(depts: { name: string; color: string | null }[]) {
    const MARGIN = 40;
    const CANVAS_W = 1860;

    // Marketing Digital se fusiona en Ventas (no recibe sala propia)
    const MERGED_INTO_VENTAS = ['marketing digital', 'marketing'];
    const deptRooms = depts.filter(
      d => !MERGED_INTO_VENTAS.includes(d.name.toLowerCase()),
    );

    const rooms: any[] = [
      {
        name: 'Sala de Juntas',
        room_type: 'meeting',
        x: MARGIN, y: MARGIN,
        width: 480, height: 200,
        color: '#7F1D1D',
      },
    ];

    if (deptRooms.length <= 3) {
      // Espacio abierto: todos trabajan juntos
      rooms.push({
        name: 'Espacio de Trabajo',
        room_type: 'department',
        x: MARGIN, y: 280,
        width: CANVAS_W - MARGIN * 2, height: 660,
        color: '#1E1E2E',
      });
      return rooms;
    }

    // Una sala por departamento en grid automático
    const cols = deptRooms.length <= 4 ? 2 : deptRooms.length <= 6 ? 3 : 4;
    const rows = Math.ceil(deptRooms.length / cols);
    const GAP = MARGIN;
    const START_Y = 280;
    const USABLE_W = CANVAS_W - MARGIN * 2;
    const USABLE_H = 980 - START_Y - MARGIN;
    const roomW = Math.floor((USABLE_W - (cols - 1) * GAP) / cols);
    const roomH = Math.floor((USABLE_H - (rows - 1) * GAP) / rows);

    deptRooms.forEach((dept, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      rooms.push({
        name: dept.name,
        room_type: 'department',
        x: MARGIN + col * (roomW + GAP),
        y: START_Y + row * (roomH + GAP),
        width: roomW,
        height: roomH,
        color: dept.color ?? '#1E293B',
      });
    });

    return rooms;
  }

  // PASO 6 — Activar la empresa + crear desk inicial del owner
  async launch(tenantId: string, erpTableNames: Record<string, string> = {}, deskWidgets: any[] = []) {
    await this.validateStep(tenantId, 5);

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'active' },
      select: { id: true, name: true, campus_config: true },
    });

    await this.prisma.onboardingProgress.update({
      where: { tenant_id: tenantId },
      data: { current_step: 6, steps_completed: STEPS, completed_at: new Date() },
    });

    // Crear dashboard inicial del owner
    await this.createOwnerDashboard(tenantId, deskWidgets);

    // Registrar cliente en ERP MentorIA + crear base Airtable propia (fire & forget, no bloquea)
    void this.provisionAirtableERP(tenant.id, tenant.name, tenant.campus_config as any, erpTableNames);

    const stats = await this.getCompanyStats(tenantId);

    return {
      launched: true,
      stats,
      message: `🚀 ¡FlowDesk activado! La empresa está lista. Los empleados ya pueden hacer login.`,
    };
  }

  private async provisionAirtableERP(tenantId: string, tenantName: string, campusConfig: Record<string, any> | null, erpTableNames: Record<string, string> = {}) {
    const owner = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
      select: { name: true, email: true },
    });

    // 1. Registrar en ERP de MentorIA
    const { crm_id, project_id } = await this.airtable.registerClientInERP({
      tenant_id: tenantId,
      company_name: tenantName,
      owner_name: owner?.name ?? tenantName,
      owner_email: owner?.email ?? '',
    });

    // 2. Crear base Airtable propia para el cliente (con nombres personalizados si los hay)
    const clientBaseId = await this.airtable.createClientBase(tenantName, erpTableNames);

    // 3. Persistir los IDs en campus_config para referencia futura
    if (crm_id || project_id || clientBaseId) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          campus_config: {
            ...(campusConfig ?? {}),
            ...(crm_id && { airtable_crm_id: crm_id }),
            ...(project_id && { airtable_project_id: project_id }),
            ...(clientBaseId && { airtable_erp_base_id: clientBaseId }),
          },
        },
      });
    }
  }

  private async createOwnerDashboard(tenantId: string, customWidgets: any[] = []) {
    const owner = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
    });
    if (!owner) return;

    const existing = await this.prisma.dashboardConfig.findFirst({
      where: { tenant_id: tenantId, slot_id: owner.id, is_default: true },
    });
    if (existing) return;

    // Si el agente de onboarding envió widgets personalizados, úsalos; si no, usa el template.
    let widgets: any[];
    let deskName: string;

    if (customWidgets.length > 0) {
      widgets = this.autoLayoutWidgets(customWidgets);
      deskName = 'Mi Escritorio';
    } else {
      const progress = await this.prisma.onboardingProgress.findFirst({ where: { tenant_id: tenantId } });
      const isMentoria = progress?.template_used === 'mentoria';
      const deskDef = isMentoria ? MENTORIA_OWNER_DESK : DEFAULT_OWNER_DESK;
      widgets = deskDef.widgets;
      deskName = deskDef.name;
    }

    const dash = await this.prisma.dashboardConfig.create({
      data: { tenant_id: tenantId, slot_id: owner.id, name: deskName, is_default: true, layout: { cols: 12, rowHeight: 80 } },
    });

    await this.prisma.dashboardWidget.createMany({
      data: widgets.map((w: any) => ({ dashboard_id: dash.id, tenant_id: tenantId, ...w })),
    });
  }

  // Auto-posiciona widgets en un grid de 12 columnas según su tipo.
  // Fila 0: métricas/kpis (hasta 3, 4 cols c/u) — Fila 1+: resto en 2 columnas (6 cols c/u).
  private autoLayoutWidgets(widgets: any[]): any[] {
    const metricTypes = ['metric', 'kpi'];
    const metrics = widgets.filter(w => metricTypes.includes(w.widget_type));
    const others = widgets.filter(w => !metricTypes.includes(w.widget_type));

    const result: any[] = [];

    // Fila 0: métricas — hasta 3, cada una ocupa 12/count columnas
    const metricCols = metrics.length === 1 ? 6 : metrics.length === 2 ? 6 : 4;
    metrics.forEach((w, i) => {
      result.push({ ...w, position: { x: i * metricCols, y: 0, w: metricCols, h: 4 } });
    });

    // Filas siguientes: el resto en 2 columnas de 6
    const startRow = metrics.length > 0 ? 4 : 0;
    others.forEach((w, i) => {
      const col = (i % 2) * 6;
      const row = startRow + Math.floor(i / 2) * 5;
      result.push({ ...w, position: { x: col, y: row, w: 6, h: 5 } });
    });

    return result;
  }

  // PASO OPCIONAL — Configurar Cultura (después de launch, llamado desde el agente de onboarding)
  async setupCulture(tenantId: string, input: Parameters<CultureService['setupFromOnboarding']>[1]) {
    return this.culture.setupFromOnboarding(tenantId, input);
  }

  // PASO OPCIONAL — Registrar integraciones deseadas
  async setupIntegrations(tenantId: string, items: { provider: string; priority?: string; notes?: string }[]) {
    return this.integrations.registerWishlist(tenantId, items);
  }

  // PASO OPCIONAL — Configurar metas AUP (después de launch, llamado desde el agente de onboarding)
  async setupAupGoals(tenantId: string, input: {
    mission?: string;
    vision?: string;
    values?: string[];
    company_ksfs?: Array<{
      name: string; unit: string; description?: string;
      min: number; sat: number; out: number;
      category?: string; source?: string; freq?: string;
    }>;
    dept_ksfs?: Array<{
      dept_id: string; name: string; unit: string; description?: string;
      min: number; sat: number; out: number;
      category?: string; source?: string; freq?: string;
    }>;
    owner_ksfs?: Array<{
      name: string; unit: string; description?: string;
      min: number; sat: number; out: number;
      category?: string; source?: string; freq?: string;
    }>;
  }) {
    const results: Record<string, any> = { company_ksfs: [], dept_ksfs: [], owner_ksfs: [] };

    // 1. Propósito estratégico (si hay misión o visión)
    if (input.mission || input.vision) {
      await this.ksf.upsertStrategicPurpose(tenantId, {
        vision: input.vision ?? 'Por definir',
        mission: input.mission,
        values: input.values,
      });
    }

    const resolveCategory = (cat?: string): KsfCategory => {
      const MAP: Record<string, KsfCategory> = {
        operational: KsfCategory.OPERATIONAL,
        coordination: KsfCategory.COORDINATION,
        strategic: KsfCategory.STRATEGIC,
      };
      return MAP[cat?.toLowerCase() ?? ''] ?? KsfCategory.OPERATIONAL;
    };

    const resolveSource = (src?: string): MeasurementSource => {
      // Si no se especifica, usar MANUAL
      const valid = Object.values(MeasurementSource) as string[];
      if (src && valid.includes(src)) return src as MeasurementSource;
      return MeasurementSource.MANUAL;
    };

    const resolveFreq = (freq?: string): MeasurementFrequency => {
      const MAP: Record<string, MeasurementFrequency> = {
        daily: MeasurementFrequency.DAILY,
        weekly: MeasurementFrequency.WEEKLY,
        monthly: MeasurementFrequency.MONTHLY,
        quarterly: MeasurementFrequency.QUARTERLY,
      };
      return MAP[freq?.toLowerCase() ?? ''] ?? MeasurementFrequency.MONTHLY;
    };

    // 2. KSFs de empresa
    for (const k of input.company_ksfs ?? []) {
      try {
        const created = await this.ksf.createKsf(tenantId, {
          name: k.name,
          description: k.description,
          unit: k.unit,
          level: KsfLevel.COMPANY,
          category: resolveCategory(k.category ?? 'strategic'),
          origin: KsfOrigin.TOP_DOWN,
          measurement_source: resolveSource(k.source),
          measurement_freq: resolveFreq(k.freq ?? 'monthly'),
          minimum_level: k.min,
          satisfactory_level: k.sat,
          outstanding_level: k.out,
        });
        results.company_ksfs.push({ id: created.id, name: created.name });
      } catch (e: any) {
        results.company_ksfs.push({ name: k.name, error: e.message });
      }
    }

    // 3. KSFs de departamentos
    for (const k of input.dept_ksfs ?? []) {
      try {
        const created = await this.ksf.createKsf(tenantId, {
          name: k.name,
          description: k.description,
          unit: k.unit,
          level: KsfLevel.DEPARTMENT,
          dept_id: k.dept_id,
          category: resolveCategory(k.category ?? 'operational'),
          origin: KsfOrigin.TOP_DOWN,
          measurement_source: resolveSource(k.source),
          measurement_freq: resolveFreq(k.freq ?? 'weekly'),
          minimum_level: k.min,
          satisfactory_level: k.sat,
          outstanding_level: k.out,
        });
        results.dept_ksfs.push({ id: created.id, name: created.name, dept_id: k.dept_id });
      } catch (e: any) {
        results.dept_ksfs.push({ name: k.name, dept_id: k.dept_id, error: e.message });
      }
    }

    // 4. KSFs personales del owner
    const owner = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
      select: { id: true },
    });

    if (owner) {
      for (const k of input.owner_ksfs ?? []) {
        try {
          const created = await this.ksf.createKsf(tenantId, {
            name: k.name,
            description: k.description,
            unit: k.unit,
            level: KsfLevel.EMPLOYEE,
            team_slot_id: owner.id,
            category: resolveCategory(k.category ?? 'operational'),
            origin: KsfOrigin.TOP_DOWN,
            measurement_source: resolveSource(k.source),
            measurement_freq: resolveFreq(k.freq ?? 'weekly'),
            minimum_level: k.min,
            satisfactory_level: k.sat,
            outstanding_level: k.out,
          });
          results.owner_ksfs.push({ id: created.id, name: created.name });
        } catch (e: any) {
          results.owner_ksfs.push({ name: k.name, error: e.message });
        }
      }

      // 5. Escalation config del owner con valores por defecto
      await this.ksf.upsertEscalationConfig(tenantId, owner.id, {
        threshold1_periods: 4,
        threshold1_levels: 2,
        threshold2_periods: 8,
        threshold2_levels: 3,
      });
    }

    return {
      ok: true,
      strategic_purpose_updated: !!(input.mission || input.vision),
      ...results,
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

  private async mergeCampusConfig(tenant_id: string, patch: Record<string, any>): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenant_id },
      select: { campus_config: true },
    });
    const current = (tenant.campus_config as Record<string, any>) ?? {};
    await this.prisma.tenant.update({
      where: { id: tenant_id },
      data: { campus_config: { ...current, ...patch } },
    });
  }

  async createSop(tenant_id: string, sop: {
    name: string;
    description?: string;
    category?: string;
    frequency?: string;
    product_line?: string;
    steps?: Array<{ order: number; action: string; tool?: string; responsible?: string; duration_min?: number; failure_mode?: string }>;
    checklist?: string[];
  }): Promise<{ ok: boolean; sop_id: string; name: string }> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenant_id }, select: { campus_config: true },
    });
    const cfg = (tenant.campus_config as Record<string, any>) ?? {};
    const sops: any[] = cfg.sops ?? [];
    const newSop = { id: `sop_${Date.now()}`, ...sop, category: sop.category ?? 'internal', steps: sop.steps ?? [], checklist: sop.checklist ?? [] };
    sops.push(newSop);
    await this.prisma.tenant.update({ where: { id: tenant_id }, data: { campus_config: { ...cfg, sops } } });
    return { ok: true, sop_id: newSop.id, name: newSop.name };
  }

  async savePlatformConfig(tenant_id: string, config: {
    managed_tenants?: Array<{ name: string; plan?: string; contact?: string; status?: string }>;
    platform_kpis?: string[];
    alert_preferences?: Record<string, any>;
  }): Promise<{ ok: boolean }> {
    await this.mergeCampusConfig(tenant_id, { platform_config: config });
    await this.prisma.tenant.update({
      where: { id: tenant_id },
      data: { tenant_type: 'PLATFORM' },
    });
    return { ok: true };
  }

  async saveReportPreferences(tenant_id: string, prefs: {
    daily_brief_time?: string;
    weekly_day?: string;
    client_report_frequency?: string;
    report_format?: string;
    alert_thresholds?: Record<string, any>;
    report_templates?: Array<{
      type: string; frequency: string; sections: string[];
    }>;
  }): Promise<{ ok: boolean }> {
    await this.mergeCampusConfig(tenant_id, { report_preferences: prefs });
    return { ok: true };
  }

  async saveFounderProfileExtended(tenant_id: string, slot_id: string, profile: {
    peak_hours?: string;
    work_style?: string;
    communication_preference?: string;
    directness_level?: number;
    sacred_time?: Array<{ day: string; from: string; to: string; reason?: string }>;
    protected_routines?: string[];
    delegation_threshold?: string;
    personal_goal?: string;
  }): Promise<{ ok: boolean }> {
    const existing = await this.prisma.founderProfile.findUnique({ where: { tenant_id } });
    if (existing) {
      await this.prisma.founderProfile.update({
        where: { tenant_id },
        data: {
          loved_behaviors:  profile.protected_routines as any,
          doing_well_means: profile.personal_goal,
          operating_style:  profile.work_style,
        },
      });
    }
    await this.mergeCampusConfig(tenant_id, { founder_work_style: profile });
    return { ok: true };
  }

  async saveRhythmsCalendar(tenant_id: string, config: {
    calendar_provider?: string;
    calendar_ids?: string[];
    recurring_meetings?: Array<{
      name: string; day_of_week?: string; time?: string;
      frequency?: string; participants?: string[]; duration_min?: number;
    }>;
    critical_dates?: Array<{ date: string; description: string; recurrent?: boolean }>;
    business_cycles?: Array<{ name: string; start_day: number; end_day?: number }>;
  }): Promise<{ ok: boolean }> {
    await this.mergeCampusConfig(tenant_id, { calendar_config: config });
    return { ok: true };
  }

  async saveActiveClients(tenant_id: string, clients: Array<{
    name: string;
    product_line?: string;
    start_date?: string;
    end_date?: string;
    mrr?: number;
    owner_slot_id?: string;
    status?: string;
    priority_note?: string;
    has_flowdesk?: boolean;
  }>): Promise<{ ok: boolean }> {
    await this.mergeCampusConfig(tenant_id, { active_clients: clients });
    return { ok: true };
  }

  async savePrivacyConfig(tenant_id: string, config: {
    financial_visibility?: string;
    client_data_scope?: string;
    sensitive_fields?: string[];
    data_retention_days?: number;
    offboarding_procedure?: string;
  }): Promise<{ ok: boolean }> {
    await this.mergeCampusConfig(tenant_id, { privacy_config: config });
    return { ok: true };
  }

  async saveCommChannels(tenant_id: string, channels: {
    email?: Array<{ address: string; purpose?: string; priority?: string; monitor?: boolean }>;
    whatsapp?: Array<{ number: string; type?: string; tool?: string }>;
    social_media?: Array<{ platform: string; handle?: string; manager_slot_id?: string; monitor_dms?: boolean }>;
    crm_integration?: { provider?: string; new_lead_alert?: boolean };
    war_room?: { enabled?: boolean; auto_summary?: boolean; notify_participants?: boolean };
    internal?: Array<{ tool: string; workspace_id?: string }>;
  }): Promise<{ ok: boolean }> {
    await this.mergeCampusConfig(tenant_id, { communication_channels: channels });
    return { ok: true };
  }

  async saveContentInventory(tenant_id: string, inventory: {
    brand?: { logo?: { exists: boolean; url?: string }; brandbook?: { exists: boolean; url?: string } };
    digital_presence?: { website?: { exists: boolean; url?: string; updated?: boolean } };
    social_media?: { profiles?: Array<{ platform: string; handle?: string; active?: boolean }> };
    mailing?: { list_size?: number; tool?: string; welcome_sequence?: { exists: boolean } };
    sales_material?: { one_pager?: { exists: boolean }; case_studies?: { exists: boolean; count?: number } };
    proposals?: { quote_template?: { exists: boolean }; contracts?: { exists: boolean } };
  }): Promise<{ ok: boolean; pending_count: number }> {
    await this.mergeCampusConfig(tenant_id, { content_inventory: inventory });
    const flat = JSON.stringify(inventory);
    const pending = (flat.match(/"exists":false/g) ?? []).length;
    return { ok: true, pending_count: pending };
  }

  async saveEmployeeTool(slot_id: string, tool: {
    tool_name: string;
    tool_category: string;
    integration_type: string;
    use_cases?: string[];
    autonomy_level?: {
      auto_execute?: string[];
      requires_approval?: string[];
      forbidden?: string[];
    };
    usage_frequency?: string;
    priority_rank?: number;
  }): Promise<{ ok: boolean }> {
    const slot = await this.prisma.teamSlot.findUniqueOrThrow({
      where: { id: slot_id },
      select: { secretary_config: true },
    });
    const config = (slot.secretary_config as any) ?? { connected_tools: [], workflow_templates: [] };
    const existing = config.connected_tools as any[];
    const idx = existing.findIndex((t: any) => t.tool_name === tool.tool_name);
    if (idx >= 0) existing[idx] = tool;
    else existing.push(tool);
    config.connected_tools = existing;
    await this.prisma.teamSlot.update({
      where: { id: slot_id },
      data: { secretary_config: config },
    });
    return { ok: true };
  }

  async updateSop(tenant_id: string, sop_id: string, patch: {
    bpmn_xml?: string;
    name?: string;
    description?: string;
    steps?: any[];
  }): Promise<{ ok: boolean }> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenant_id }, select: { campus_config: true },
    });
    const cfg = (tenant.campus_config as Record<string, any>) ?? {};
    const sops: any[] = cfg.sops ?? [];
    const idx = sops.findIndex((s: any) => s.id === sop_id);
    if (idx < 0) return { ok: false };
    sops[idx] = { ...sops[idx], ...patch, updated_at: new Date().toISOString() };
    await this.prisma.tenant.update({
      where: { id: tenant_id },
      data: { campus_config: { ...cfg, sops } },
    });
    return { ok: true };
  }

  async generateSopBpmn(tenant_id: string, sop_id: string): Promise<{ ok: boolean; bpmn_xml?: string }> {
    const anthropic = new Anthropic();

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenant_id }, select: { campus_config: true, name: true },
    });
    const cfg = (tenant.campus_config as Record<string, any>) ?? {};
    const sop = (cfg.sops ?? []).find((s: any) => s.id === sop_id);
    if (!sop) return { ok: false };

    const stepsText = (sop.steps ?? []).map((s: any, i: number) =>
      `${i + 1}. ${s.action}${s.responsible ? ` (${s.responsible})` : ''}${s.tool ? ` — herramienta: ${s.tool}` : ''}`
    ).join('\n');

    const prompt = `Genera un diagrama BPMN 2.0 XML válido para este proceso de negocio.

PROCESO: ${sop.name}
EMPRESA: ${tenant.name}
DESCRIPCIÓN: ${sop.description ?? 'Sin descripción'}
CATEGORÍA: ${sop.category ?? 'internal'}

PASOS:
${stepsText || 'Sin pasos definidos — genera un flujo básico de inicio, proceso principal y fin.'}

REGLAS ESTRICTAS:
- Responde SOLO con el XML, sin texto antes ni después, sin \`\`\`xml
- BPMN 2.0 válido que renderice en bpmn-js
- Máximo 15 elementos (tareas + eventos + gateways)
- Cada elemento debe tener id único: "start", "task_1", "task_2", "end_1", etc.
- Incluir startEvent, una task por cada paso, endEvent
- Si hay pasos de decisión (si/no, validar, aprobar), usar exclusiveGateway
- Namespace obligatorio: xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
- Incluir sección bpmndi:BPMNDiagram con posiciones (x, y, width, height) para cada elemento
- Las posiciones deben ser coherentes (flujo de izquierda a derecha, separadas ~160px entre tareas)

Genera el XML completo ahora:`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '';
    const xmlMatch = text.match(/(<\?xml[\s\S]*<\/definitions>)/);
    const xml = xmlMatch?.[1] ?? (text.trim().startsWith('<?xml') ? text.trim() : null);

    if (!xml) return { ok: false };

    await this.updateSop(tenant_id, sop_id, { bpmn_xml: xml });
    return { ok: true, bpmn_xml: xml };
  }

  async importAuditReport(tenant_id: string, audit_text: string): Promise<{
    ok: boolean;
    sops_created: number;
    message: string;
  }> {
    const anthropic = new Anthropic();

    const extractionPrompt = `Eres un extractor de datos de reportes de auditoría de negocios.

Lee este reporte y extrae los procesos/flujos de trabajo mencionados en formato JSON.

REPORTE:
${audit_text.slice(0, 6000)}

Responde SOLO con JSON válido, sin texto extra ni backticks:
{
  "processes": [
    {
      "name": "Nombre del proceso",
      "description": "Descripción breve en una oración",
      "category": "client_onboarding|delivery|internal|admin",
      "frequency": "daily|weekly|monthly|on_demand",
      "product_line": "línea de producto si se menciona",
      "steps": [
        { "order": 1, "action": "Descripción del paso", "responsible": "Quién lo hace", "tool": "Herramienta si se menciona" }
      ]
    }
  ],
  "summary": "Resumen de 1 línea de lo importado"
}

Máximo 5 procesos. Si no hay procesos claros, devuelve { "processes": [], "summary": "Sin procesos detectados" }.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: extractionPrompt }],
    });

    const text = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '{}';
    let extracted: { processes?: any[]; summary?: string } = {};
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      extracted = JSON.parse(jsonMatch?.[0] ?? text);
    } catch {
      return { ok: false, sops_created: 0, message: 'No se pudo parsear el reporte' };
    }

    const processes = extracted.processes ?? [];
    let created = 0;
    for (const proc of processes) {
      try {
        const result = await this.createSop(tenant_id, {
          name:         proc.name,
          description:  proc.description,
          category:     proc.category ?? 'internal',
          frequency:    proc.frequency,
          product_line: proc.product_line,
          steps:        proc.steps ?? [],
        });
        await this.generateSopBpmn(tenant_id, result.sop_id).catch(() => null);
        created++;
      } catch { /* continuar con el siguiente */ }
    }

    return {
      ok: true,
      sops_created: created,
      message: extracted.summary ?? `${created} procesos importados`,
    };
  }

  async saveAccountType(tenantId: string, accountType: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { campus_config: true },
    });
    const current = (tenant?.campus_config as Record<string, unknown>) ?? {};
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { campus_config: { ...current, account_type: accountType } },
    });
  }
}
