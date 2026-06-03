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

  // ─── Cron: lunes 8am CDMX — avisa al CEO que el CEO Digital quiere platicar ───

  @Cron('0 8 * * 1', { timeZone: 'America/Mexico_City' })
  async runWeeklyMeetingForAllTenants(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) return;
    this.logger.log('Iniciando notificaciones de junta semanal...');

    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'active', tenant_type: { in: ['NETWORK', 'BRANCH'] } },
      select: { id: true, name: true },
    });

    for (const tenant of tenants) {
      try {
        await this.generateWeeklyMeeting(tenant.id);
      } catch (err) {
        this.logger.warn(`Error en junta semanal de ${tenant.name}: ${err}`);
      }
    }
    this.logger.log('Notificaciones de junta enviadas.');
  }

  // ─── Generar talking points y avisar al CEO ───────────────────────────────────

  async generateWeeklyMeeting(tenantId: string): Promise<{ created: boolean; summary?: string }> {
    if (!process.env.ANTHROPIC_API_KEY) return { created: false };

    const owner = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, role: 'owner', type: 'HUMAN' },
      select: { id: true, name: true },
    });
    if (!owner) return { created: false };

    const ceoAgent = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'ceo' },
      select: { id: true, name: true },
    });

    // No duplicar si ya existe una sin atender esta semana
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
    const existing = await this.prisma.pendingApproval.findFirst({
      where: { tenant_id: tenantId, status: 'pending', created_at: { gte: weekStart }, context: { path: ['type'], equals: 'weekly_meeting' } },
    });
    if (existing) return { created: false };

    // Recolectar datos y generar talking points (no una agenda formal, sino los temas de conversación)
    const data = await this.collectMeetingData(tenantId, owner.id);
    const talkingPoints = await this.buildTalkingPoints({ ...data, tenantId }, owner.name, ceoAgent?.name ?? 'CEO Digital');

    // Guardar talking points en PendingApprovals — Atlas los usará cuando el CEO abra el chat
    await this.prisma.pendingApproval.create({
      data: {
        tenant_id: tenantId,
        requested_by: ceoAgent?.id ?? owner.id,
        description: `💬 ${ceoAgent?.name ?? 'CEO Digital'} quiere charlar — pendientes de la semana`,
        context: {
          type: 'weekly_meeting',
          week_date: new Date().toISOString(),
          talking_points: talkingPoints,
          raw_data: data,
          ceo_agent_name: ceoAgent?.name ?? 'CEO Digital',
          owner_name: owner.name,
          attended: false,
        } as any,
      },
    });

    // Mandar WhatsApp casual al CEO
    await this.sendWhatsAppInvitation(tenantId, owner, ceoAgent?.name ?? 'CEO Digital').catch(() => {});

    // Notificación in-app como respaldo
    await this.prisma.notification.create({
      data: {
        tenant_id: tenantId, recipient_slot_id: owner.id,
        type: 'weekly_meeting',
        title: `${ceoAgent?.name ?? 'CEO Digital'} quiere charlar 👋`,
        content: 'Tiene los pendientes de la semana listos y quiere platicarlos contigo.',
        action_url: `/agents/${ceoAgent?.id ?? ''}`,
      },
    }).catch(() => {});

    this.logger.log(`[${tenantId}] Invitación semanal enviada a ${owner.name}`);
    return { created: true, summary: talkingPoints.slice(0, 300) };
  }

  // ─── Check: ¿hay junta pendiente esta semana? (para inyectar en el chat) ──────

  async getPendingWeeklyMeeting(tenantId: string): Promise<Record<string, any> | null> {
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
    const pending = await this.prisma.pendingApproval.findFirst({
      where: { tenant_id: tenantId, status: 'pending', created_at: { gte: weekStart }, context: { path: ['type'], equals: 'weekly_meeting' } },
      orderBy: { created_at: 'desc' },
    });
    return pending ? (pending.context as Record<string, any>) : null;
  }

  async markMeetingAttended(tenantId: string): Promise<void> {
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
    await this.prisma.pendingApproval.updateMany({
      where: { tenant_id: tenantId, status: 'pending', created_at: { gte: weekStart }, context: { path: ['type'], equals: 'weekly_meeting' } },
      data: { status: 'approved', resolved_at: new Date() },
    }).catch(() => {});
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

  // ─── Genera talking points (no un reporte — son temas para conversar) ───────────

  private async buildTalkingPoints(data: Record<string, any>, ownerName: string, agentName: string): Promise<string> {
    const industryInsights = await this.researchIndustryInsights(data.tenantId ?? '').catch(() => '');

    const prompt = `Eres ${agentName}, el CEO Digital. Prepara tus TALKING POINTS para la charla semanal con ${ownerName}.
NO generes un reporte formal. Genera los temas que quieres conversar — como si los apuntaras en tu libreta antes de una charla de café.
Sé específico, directo y humano.

DATOS DE LA SEMANA:
${JSON.stringify(data, null, 2)}

INVESTIGACIÓN DE INDUSTRIA (lo que investigaste esta semana):
${industryInsights || '(sin investigación esta semana)'}

Formato — bullet points concisos, 5-7 temas ordenados por importancia:
• [Tema]: [1-2 líneas de lo que quieres decir/preguntar/proponer]

Incluye al menos: 1 tema de equipo, 1 de procesos/journey, 1 de ideas externas, 1 de configuración pendiente, 1 propuesta nueva.
Tono: como notas de un co-founder antes de un café, no como un reporte corporativo.
Máximo 300 palabras.`;

    const response = await this.anthropic.messages.create({
      model: MEETING_MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  // ─── WhatsApp casual al CEO vía Evolution API ────────────────────────────────

  private async sendWhatsAppInvitation(tenantId: string, owner: { id: string; name: string }, agentName: string): Promise<void> {
    const secretaryConfig = await this.prisma.secretaryConfig.findUnique({
      where: { tenant_id: tenantId },
      select: { evolution_instance: true, owner_phone: true, evolution_url: true },
    });
    if (!secretaryConfig?.evolution_instance || !secretaryConfig?.owner_phone) return;

    const ownerFirstName = owner.name.split(' ')[0];
    const message = `Oye ${ownerFirstName} 👋\n\n${agentName} aquí. Estuve revisando todo esta semana y tengo unas cosas que quiero platicar contigo — cómo vamos con el equipo, unos huecos que vi en los procesos y una idea que me parece interesante.\n\n¿Tienes unos minutos para la charla semanal? Puedes encontrarme en la app cuando quieras 🙌`;

    const evolutionUrl = secretaryConfig.evolution_url ?? process.env.EVOLUTION_API_URL;
    if (!evolutionUrl || !process.env.EVOLUTION_API_KEY) return;

    await fetch(`${evolutionUrl}/message/sendText/${secretaryConfig.evolution_instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.EVOLUTION_API_KEY },
      body: JSON.stringify({
        number: `${secretaryConfig.owner_phone}@s.whatsapp.net`,
        text: message,
      }),
    }).catch(() => {});
  }
    }).catch(() => {});
  }
}
