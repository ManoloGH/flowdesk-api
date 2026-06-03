import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';

const MEETING_MODEL = 'claude-sonnet-4-6';

@Injectable()
export class WeeklyMeetingService {
  private readonly logger = new Logger(WeeklyMeetingService.name);
  private readonly anthropic: Anthropic;

  constructor(private prisma: PrismaService) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // ─── Cron: lunes 8am hora Ciudad de México ───────────────────────────────────

  @Cron('0 8 * * 1', { timeZone: 'America/Mexico_City' })
  async runWeeklyMeetingForAllTenants(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) return;

    this.logger.log('Iniciando generación de juntas semanales...');

    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'active', tenant_type: { in: ['NETWORK', 'BRANCH'] } },
      select: { id: true, name: true },
    });

    for (const tenant of tenants) {
      try {
        await this.generateWeeklyMeeting(tenant.id);
      } catch (err) {
        this.logger.warn(`Error generando junta para ${tenant.name}: ${err}`);
      }
    }

    this.logger.log('Juntas semanales generadas.');
  }

  // ─── Generar la junta semanal para un tenant ─────────────────────────────────

  async generateWeeklyMeeting(tenantId: string): Promise<{ created: boolean; summary?: string }> {
    if (!process.env.ANTHROPIC_API_KEY) return { created: false };

    const owner = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
      select: { id: true, name: true },
    });
    if (!owner) return { created: false };

    // Recolectar todos los datos de la empresa
    const data = await this.collectMeetingData(tenantId, owner.id);

    // Generar agenda con Claude (incluye investigación de industria)
    const agenda = await this.buildAgenda({ ...data, tenantId }, owner.name);

    // Buscar el CEO Agent del tenant
    const ceoAgent = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'ceo' },
      select: { id: true, name: true },
    });

    // Guardar en PendingApprovals para que el CEO la vea
    await this.prisma.pendingApproval.create({
      data: {
        tenant_id: tenantId,
        requested_by: ceoAgent?.id ?? owner.id,
        description: `📋 Junta semanal CEO Digital — ${new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}`,
        context: {
          type: 'weekly_meeting',
          week_date: new Date().toISOString(),
          agenda_markdown: agenda,
          raw_data: data,
          ceo_agent_name: ceoAgent?.name ?? 'CEO Digital',
        } as any,
      },
    });

    // Intentar notificar al CEO vía Secretary (si está configurado)
    await this.notifyOwner(tenantId, owner.id, agenda).catch(() => {});

    this.logger.log(`[${tenantId}] Junta semanal generada para ${owner.name}`);
    return { created: true, summary: agenda.slice(0, 300) };
  }

  // ─── Recolectar datos para la junta ──────────────────────────────────────────

  async collectMeetingData(tenantId: string, ownerSlotId: string): Promise<Record<string, any>> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      founder, voice, blueprint, operatingMap,
      allSlots, integrations, departments, onboarding, ksfs,
      managementReports, feedbackReports, pendingApprovals,
      openDeals, brainDocs, agentConversations,
    ] = await Promise.all([
      this.prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.cultureBlueprint.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.operatingMap.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.teamSlot.findMany({ where: { tenant_id: tenantId }, select: { id: true, name: true, type: true, role: true, agent_role: true, agent_config: true, department_id: true } }),
      this.prisma.integration.findMany({ where: { tenant_id: tenantId, status: 'connected' }, select: { provider: true } }),
      this.prisma.department.findMany({ where: { tenant_id: tenantId }, select: { id: true, name: true } }),
      this.prisma.onboardingProgress.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.keySuccessFactor.findMany({ where: { tenant_id: tenantId }, select: { team_slot_id: true, name: true, is_active: true } }),
      this.prisma.managementReport.findMany({ where: { tenant_id: tenantId }, orderBy: { week_start: 'desc' }, take: 5 }),
      this.prisma.feedbackReport.findMany({ where: { tenant_id: tenantId }, orderBy: { week_start: 'desc' }, take: 10 }),
      this.prisma.pendingApproval.findMany({ where: { tenant_id: tenantId, status: 'pending' }, orderBy: { created_at: 'desc' } }),
      this.prisma.deal.findMany({ where: { tenant_id: tenantId, status: { notIn: ['won', 'lost'] } }, select: { title: true, value: true, stage_name: true, updated_at: true }, take: 20 }),
      this.prisma.empresaBrainDocument.count({ where: { tenant_id: tenantId } }),
      this.prisma.agentConversation.count({ where: { agent: { tenant_id: tenantId }, started_at: { gte: weekAgo } } }),
    ]);

    const humans = allSlots.filter(s => s.type === 'HUMAN');
    const agents = allSlots.filter(s => s.type === 'AI_AGENT');
    const ceoAgent = agents.find(a => a.agent_role === 'ceo');

    // Config gaps
    const dnaFields = ['industry_change', 'differentiator', 'loved_behaviors', 'zero_tolerance', 'doing_well_means', 'team_feeling', 'client_energy', 'ai_tasks', 'ai_never_replace'];
    const missingDna = founder ? dnaFields.filter(f => { const v = (founder as any)[f]; return !v || (Array.isArray(v) && v.length === 0); }) : dnaFields;
    const slotsWithKsf = new Set(ksfs.map(k => k.team_slot_id));
    const humanWithoutKsf = humans.filter(s => !slotsWithKsf.has(s.id));

    // Journey coverage
    const processes = (operatingMap?.key_processes as any[] | null) ?? [];
    const JOURNEY_KEYWORDS: Record<string, string[]> = {
      'Contenido/Publicidad': ['contenido', 'publicidad', 'ads', 'redes', 'marketing'],
      'Ventas': ['propuesta', 'cierre', 'venta', 'prospecto', 'calificación'],
      'Onboarding cliente': ['onboarding', 'activación', 'bienvenida'],
      'Entrega': ['entrega', 'delivery', 'ejecución'],
      'Soporte': ['soporte', 'atención', 'ticket'],
      'Postventa': ['postventa', 'seguimiento', 'satisfacción'],
      'Facturación': ['factura', 'cobro', 'pago', 'cfdi'],
      'Legal': ['contrato', 'legal', 'acuerdo'],
      'Contabilidad': ['contabilidad', 'impuestos', 'sat'],
    };
    const processText = processes.map((p: any) => `${p.name} ${p.steps?.join(' ') ?? ''}`).join(' ').toLowerCase();
    const journeyGaps = Object.entries(JOURNEY_KEYWORDS)
      .filter(([, kw]) => !kw.some(k => processText.includes(k)))
      .map(([area]) => area);

    // Evoluciones pendientes
    const evolutionApprovals = pendingApprovals.filter(a => (a.context as any)?.type === 'agent_evolution');
    const weeklyMeetingApprovals = pendingApprovals.filter(a => (a.context as any)?.type === 'weekly_meeting');

    return {
      week: new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
      team: { total_humans: humans.length, total_agents: agents.length, without_ksf: humanWithoutKsf.map(h => h.name) },
      onboarding: { complete: !!onboarding?.completed_at, step: onboarding?.current_step ?? 0 },
      config: { dna_missing: missingDna.length, ceo_calibrated: !!(ceoAgent?.agent_config as any)?.calibrated_at, has_voice: !!voice?.voice_summary, has_blueprint: !!(blueprint?.philosophy_statements as any[])?.length, departments: departments.length, integrations: integrations.map(i => i.provider) },
      journey: { gaps: journeyGaps, processes_documented: processes.length },
      management_reports: managementReports.slice(0, 3).map(r => ({ manager: r.manager_slot_id, zone1: (r.zone_breakdown as any)?.zone1 ?? 0, zone3: (r.zone_breakdown as any)?.zone3 ?? 0, zone4: (r.zone_breakdown as any)?.zone4 ?? 0 })),
      feedback_reports: feedbackReports.slice(0, 5).map(r => ({ slot: r.team_slot_id, exceptions_above: (r.exceptions_above as any[])?.length ?? 0, exceptions_below: (r.exceptions_below as any[])?.length ?? 0 })),
      pending_approvals: { total: pendingApprovals.length, agent_evolutions: evolutionApprovals.length, weekly_meetings: weeklyMeetingApprovals.length, other: pendingApprovals.length - evolutionApprovals.length - weeklyMeetingApprovals.length },
      sales: { open_deals: openDeals.length, total_value: openDeals.reduce((s, d) => s + (d.value ?? 0), 0), pipeline: openDeals.slice(0, 5).map(d => ({ title: d.title, stage: d.stage_name, value: d.value })) },
      brain_docs: brainDocs,
      agent_conversations_this_week: agentConversations,
    };
  }

  // ─── Investigación de industria (lo que hacen otras empresas) ────────────────

  private async researchIndustryInsights(tenantId: string): Promise<string> {
    const [founder, brain] = await Promise.all([
      this.prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.empresaBrainDocument.findMany({ where: { tenant_id: tenantId, source_type: { in: ['identity', 'culture', 'sop'] } }, select: { title: true, content: true }, take: 5 }),
    ]);

    const industryContext = [
      founder?.industry_change ? `La empresa quiere cambiar: ${founder.industry_change}` : '',
      founder?.differentiator ? `Su diferenciador: ${founder.differentiator}` : '',
      brain.map(d => d.title).join(', '),
    ].filter(Boolean).join('\n');

    const researchPrompt = `Eres el CEO Digital de una empresa. Esta semana investigaste qué están haciendo otras empresas similares y tendencias de industria.

CONTEXTO DE LA EMPRESA:
${industryContext || 'Empresa de servicios/tecnología en México'}

Tu tarea: genera 3-4 insights CONCRETOS y ACCIONABLES sobre:
1. Qué están haciendo empresas líderes similares que esta empresa podría implementar
2. Una tendencia de mercado relevante para esta semana (IA, automatización, modelo de negocio, experiencia del cliente, etc.)
3. Un benchmark específico: cómo lo hace una empresa top en su industria vs cómo lo hace esta empresa (según lo que conoces)
4. Una práctica innovadora que podría diferenciarnos esta semana

Formato: bullet points concretos, con nombre de empresa o fuente cuando sea posible.
Sé específico — no genérico. Máximo 200 palabras.
Termina con la pregunta clave que el CEO debería responder después de leer esto.`;

    const response = await this.anthropic.messages.create({
      model: MEETING_MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: researchPrompt }],
    });

    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  // ─── Generar agenda con Claude ────────────────────────────────────────────────

  private async buildAgenda(data: Record<string, any>, ownerName: string): Promise<string> {
    // Investigar industria en paralelo
    const industryInsights = await this.researchIndustryInsights(data.tenantId ?? '').catch(() => '');

    const prompt = `Eres el CEO Digital. Genera la agenda de la junta semanal con ${ownerName}.
Tono: directo, cálido y ejecutivo. No es un reporte — es una conversación de co-founders.
Sé específico con los datos. Cuando algo está en cero, explica por qué es urgente resolverlo.
IMPORTANTE: no hagas preguntas de cuestionario. Propón, recomienda, provoca reflexión.

DATOS DE LA SEMANA:
${JSON.stringify(data, null, 2)}

INVESTIGACIÓN DE INDUSTRIA (lo que investigaste esta semana sobre otras empresas):
${industryInsights || '(investigación no disponible esta semana)'}

ESTRUCTURA DE LA JUNTA (usa estas secciones con emojis):

## 📊 Estado de la empresa esta semana
(2-3 líneas: números clave, qué mejoró, qué preocupa)

## 👥 Estado del equipo
(Zonas AUP, quién destaca, quién necesita atención. Si no hay datos, di exactamente qué falta configurar y el costo de no tenerlo)

## 🗺️ Journey del cliente — puntos ciegos
(Etapas sin documentar con impacto real: "sin proceso de postventa documentado → riesgo de churn silencioso")

## 🔍 Lo que están haciendo otras empresas
(Los insights de tu investigación semanal + cómo se compara esta empresa + qué deberíamos robarles)

## ⚙️ Configuración pendiente — lo que frena a la empresa
(Ordenado por impacto. No lista de tareas — argumenta por qué cada faltante duele)

## 💡 3 propuestas concretas para esta semana
(Específicas, con responsable sugerido y tiempo estimado)

## ✅ Compromisos
(3-5 acciones con responsable y fecha concreta)

---
400-600 palabras. Cierra con una observación personal del CEO Digital — algo que notó esta semana que quiere que el CEO sepa.`;

    const response = await this.anthropic.messages.create({
      model: MEETING_MODEL,
      max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.type === 'text' ? response.content[0].text : 'No se pudo generar la agenda.';
  }

  // ─── Notificar al CEO vía Secretary (WhatsApp) ────────────────────────────────

  private async notifyOwner(tenantId: string, ownerSlotId: string, agenda: string): Promise<void> {
    const secretaryConfig = await this.prisma.secretaryConfig.findUnique({
      where: { tenant_id: tenantId },
      select: { evolution_instance: true, owner_phone: true },
    });
    if (!secretaryConfig?.evolution_instance || !secretaryConfig?.owner_phone) return;

    // La notificación real via Evolution API se haría aquí cuando esté conectado
    // Por ahora solo creamos una notificación en-app
    await this.prisma.notification.create({
      data: {
        tenant_id: tenantId,
        recipient_slot_id: ownerSlotId,
        type: 'weekly_meeting',
        title: '📋 Junta semanal lista',
        content: 'Tu CEO Digital preparó la agenda de la semana. Revísala en Aprobaciones Pendientes.',
        action_url: '/agents',
      },
    }).catch(() => {});
  }
}
