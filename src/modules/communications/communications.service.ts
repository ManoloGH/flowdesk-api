import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';

@Injectable()
export class CommunicationsService {
  constructor(
    private prisma: PrismaService,
    private evolution: EvolutionAdapter,
  ) {}

  async getChannels(tenantId: string) {
    // Evolution instance name lives in SecretaryConfig.evolution_instance
    const secretaryConfig = await this.prisma.secretaryConfig.findUnique({
      where: { tenant_id: tenantId },
      select: { evolution_instance: true, enabled: true },
    });

    const instanceName: string | null = secretaryConfig?.evolution_instance ?? null;

    let whatsappStatus: 'connected' | 'disconnected' | 'unconfigured' = 'unconfigured';
    let whatsappNumber: string | null = null;

    if (instanceName) {
      try {
        const state = await this.evolution.getConnectionState(instanceName);
        const rawState = state?.instance?.state ?? state?.state;
        whatsappStatus = rawState === 'open' ? 'connected' : 'disconnected';
        const instances = await this.evolution.getInstances();
        const instance = Array.isArray(instances)
          ? instances.find((i: any) => i.instance?.instanceName === instanceName)
          : null;
        whatsappNumber = instance?.instance?.ownerJid?.replace('@s.whatsapp.net', '') ?? null;
      } catch {
        whatsappStatus = 'disconnected';
      }
    }

    // PBX: check if tenant has any slots with pbx_extension
    const pbxSlots = await this.prisma.teamSlot.count({
      where: { tenant_id: tenantId, pbx_extension: { not: null } },
    });

    return [
      {
        id: 'whatsapp',
        name: 'WhatsApp',
        detail: 'Evolution API',
        status: whatsappStatus,
        number: whatsappNumber,
        configHref: '/integrations',
      },
      {
        id: 'phone',
        name: 'Teléfono',
        detail: 'Asterisk ARI',
        status: pbxSlots > 0 ? 'connected' : 'unconfigured' as const,
        number: null,
        configHref: '/settings',
      },
    ];
  }

  async getContacts(tenantId: string, search?: string, typeFilter?: string) {
    // Employees: TeamSlots that are HUMAN
    const employeeWhere: any = {
      tenant_id: tenantId,
      type: 'HUMAN',
      role: { not: 'owner' },
    };
    if (search) {
      employeeWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { whatsapp_phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Contacts: leads and clients from Contact model
    const contactWhere: any = { tenant_id: tenantId };
    if (search) {
      contactWhere.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [employees, crmContacts] = await Promise.all([
      typeFilter && typeFilter !== 'employee' ? Promise.resolve([]) :
        this.prisma.teamSlot.findMany({
          where: employeeWhere,
          select: { id: true, name: true, whatsapp_phone: true, email: true, status: true, agent_role: true },
          orderBy: { name: 'asc' },
        }),
      typeFilter === 'employee' ? Promise.resolve([]) :
        this.prisma.contact.findMany({
          where: contactWhere,
          select: { id: true, first_name: true, last_name: true, phone: true, company: true, status: true },
          orderBy: { last_contact_at: 'desc' },
          take: 100,
        }),
    ]);

    const result = [
      ...employees.map(e => ({
        id: e.id,
        name: e.name,
        type: 'employee' as const,
        phone: e.whatsapp_phone ?? e.email ?? '—',
        status: e.status === 'ONLINE' || e.status === 'BUSY' ? 'active' : 'active',
        role: e.agent_role ?? undefined,
        source: 'teamslot' as const,
      })),
      ...crmContacts.map(c => ({
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || 'Sin nombre',
        type: c.status === 'customer' ? 'client' as const : 'lead' as const,
        phone: c.phone ?? '—',
        status: 'active' as const,
        role: c.company ?? undefined,
        source: 'contact' as const,
      })),
    ];

    return result;
  }

  async getRouting(tenantId: string) {
    // Check what agents are configured
    const hosAgent = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'daily_assistant' },
      select: { id: true, name: true },
    });

    const customerAgent = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: { in: ['customer_service', 'comunicacion'] } },
      select: { id: true, name: true },
    });

    const prospectingAgent = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
      select: { id: true, name: true },
    });

    return [
      {
        type: 'employee',
        label: 'Empleados',
        description: 'Números registrados como empleados en el Directorio.',
        agentLabel: hosAgent?.name ?? 'Asistente Personal (HOS)',
        agentConnected: !!hosAgent,
        fallbackMessage: 'Hola {nombre}, ¿en qué te puedo ayudar?',
        active: true,
      },
      {
        type: 'client',
        label: 'Clientes',
        description: 'Números registrados como clientes activos en el Directorio.',
        agentLabel: customerAgent?.name ?? null,
        agentConnected: !!customerAgent,
        fallbackMessage: 'Recibimos tu mensaje. Un asesor te atenderá en breve.',
        active: true,
      },
      {
        type: 'unknown',
        label: 'Desconocidos / Leads',
        description: 'Cualquier número que no esté registrado en el Directorio.',
        agentLabel: prospectingAgent?.name ?? null,
        agentConnected: !!prospectingAgent,
        fallbackMessage: 'Gracias por escribirnos. En breve te atendemos.',
        active: true,
      },
    ];
  }

  async getConversations(tenantId: string) {
    const convs = await this.prisma.agentConversation.findMany({
      where: { tenant_id: tenantId },
      select: {
        id: true,
        session_id: true,
        started_at: true,
        ended_at: true,
        context: true,
        agent: { select: { name: true, agent_role: true } },
        human: { select: { name: true, email: true, whatsapp_phone: true } },
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { content: true, role: true, created_at: true },
        },
      },
      orderBy: { started_at: 'desc' },
      take: 50,
    });

    return convs.map(c => {
      const lastMsg = c.messages[0];
      const ctx = c.context as any;
      const channel = ctx?.channel ?? 'whatsapp';
      const slotType = ctx?.contact_type ?? 'unknown';

      return {
        id: c.id,
        contactName: c.human.name,
        contactPhone: c.human.whatsapp_phone ?? c.human.email ?? '—',
        channel,
        slot: slotType,
        status: c.ended_at ? 'closed' : 'bot',
        lastMessage: lastMsg?.content?.slice(0, 120) ?? '(sin mensajes)',
        timeAgo: formatTimeAgo(c.started_at),
        agentName: c.agent.name,
      };
    });
  }

  async getSalesAgentConfig(tenantId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
      select: { id: true, name: true, agent_config: true },
    });

    if (!slot) {
      return {
        configured: false,
        nombre: null,
        actividad: null,
        propuesta_valor: null,
        preguntas_calificacion: [],
        criterios_buen_lead: null,
        criterios_mal_lead: null,
        cal_booking_url: null,
      };
    }

    const cfg = (slot.agent_config as Record<string, any>) ?? {};
    return {
      configured: true,
      slotId: slot.id,
      nombre: cfg.nombre ?? slot.name,
      actividad: cfg.actividad ?? null,
      propuesta_valor: cfg.propuesta_valor ?? null,
      preguntas_calificacion: cfg.preguntas_calificacion ?? [],
      criterios_buen_lead: cfg.criterios_buen_lead ?? null,
      criterios_mal_lead: cfg.criterios_mal_lead ?? null,
      cal_booking_url: cfg.cal_booking_url ?? null,
      evolution_instance: cfg.evolution_instance ?? null,
      journey: Array.isArray(cfg.journey) ? cfg.journey : [],
    };
  }

  async updateSalesAgentConfig(tenantId: string, body: Record<string, any>) {
    const existing = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
      select: { id: true },
    });

    const evolutionInstance: string | null = body.evolution_instance?.trim() || null;

    const agentData = {
      type: 'AI_AGENT' as const,
      agent_role: 'sales',
      tenant_id: tenantId,
      name: body.nombre ?? 'Agente de Ventas',
      agent_config: {
        nombre: body.nombre ?? 'Agente de Ventas',
        actividad: body.actividad ?? null,
        propuesta_valor: body.propuesta_valor ?? null,
        preguntas_calificacion: body.preguntas_calificacion ?? [],
        criterios_buen_lead: body.criterios_buen_lead ?? null,
        criterios_mal_lead: body.criterios_mal_lead ?? null,
        cal_booking_url: body.cal_booking_url ?? null,
        journey: Array.isArray(body.journey) ? body.journey : [],
        evolution_instance: evolutionInstance,
        // Ensure correct model format for OpenRouter when chatting via FlowDesk UI
        ai_provider: 'openrouter',
        model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4-5',
      },
    };

    if (existing) {
      await this.prisma.teamSlot.update({
        where: { id: existing.id },
        data: { name: agentData.name, agent_config: agentData.agent_config },
      });
    } else {
      await this.prisma.teamSlot.create({ data: agentData });
    }

    // Upsert Integration record so resolveTenant() can find this tenant
    // when Evolution API sends a webhook for this instance.
    if (evolutionInstance) {
      const existingIntegration = await this.prisma.integration.findFirst({
        where: {
          tenant_id: tenantId,
          provider: 'whatsapp',
          config: { path: ['instance_name'], equals: evolutionInstance },
        },
        select: { id: true },
      });

      if (existingIntegration) {
        await this.prisma.integration.update({
          where: { id: existingIntegration.id },
          data: { status: 'connected', config: { instance_name: evolutionInstance } },
        });
      } else {
        await this.prisma.integration.create({
          data: {
            tenant_id: tenantId,
            provider: 'whatsapp',
            status: 'connected',
            config: { instance_name: evolutionInstance },
          },
        });
      }

      // Auto-configure Evolution API webhook so messages reach FlowDesk
      const apiBase = process.env.API_PUBLIC_URL ?? 'https://api.flowdesk.mx';
      const webhookUrl = `${apiBase}/api/v1/webhooks/evolution`;
      await this.evolution.setWebhook(evolutionInstance, webhookUrl).catch(() => {});
    }

    return { ok: true };
  }
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
