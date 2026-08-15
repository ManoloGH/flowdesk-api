import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';

@Injectable()
export class CommunicationsService {
  constructor(
    private prisma: PrismaService,
    private evolution: EvolutionAdapter,
  ) {}

  // ─── Channels ─────────────────────────────────────────────────────────────

  async getChannels(tenantId: string) {
    // Auto-seed WhatsApp channel from SecretaryConfig if not yet in DB
    const secretaryConfig = await this.prisma.secretaryConfig.findUnique({
      where: { tenant_id: tenantId },
      select: { evolution_instance: true },
    });

    if (secretaryConfig?.evolution_instance) {
      const instanceName = secretaryConfig.evolution_instance;
      await (this.prisma as any).channel.upsert({
        where: { tenant_id_external_id: { tenant_id: tenantId, external_id: instanceName } },
        create: {
          tenant_id: tenantId,
          type: 'whatsapp',
          external_id: instanceName,
          name: 'WhatsApp',
          config_href: '/integrations',
        },
        update: {},
      });
    }

    // Also auto-seed from Integration records (sales agent instances)
    const integrations = await this.prisma.integration.findMany({
      where: { tenant_id: tenantId, provider: 'whatsapp', status: 'connected' },
      select: { config: true },
    });
    for (const integ of integrations) {
      const cfg = integ.config as Record<string, any>;
      const instanceName: string | null = cfg?.instance_name ?? null;
      if (!instanceName) continue;
      await (this.prisma as any).channel.upsert({
        where: { tenant_id_external_id: { tenant_id: tenantId, external_id: instanceName } },
        create: {
          tenant_id: tenantId,
          type: 'whatsapp',
          external_id: instanceName,
          name: 'WhatsApp — ' + instanceName,
          config_href: '/agents',
        },
        update: {},
      });
    }

    // Load all channels from DB
    const dbChannels = await (this.prisma as any).channel.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'asc' },
    });

    // Enrich WhatsApp channels with live Evolution status
    const enriched = await Promise.all(dbChannels.map(async (ch: any) => {
      if (ch.type === 'whatsapp') {
        let status: 'connected' | 'disconnected' | 'unconfigured' = 'unconfigured';
        let number: string | null = ch.number;
        try {
          const state = await this.evolution.getConnectionState(ch.external_id);
          const rawState = state?.instance?.state ?? state?.state;
          status = rawState === 'open' ? 'connected' : 'disconnected';
          if (!number) {
            const instances = await this.evolution.getInstances();
            const instance = Array.isArray(instances)
              ? instances.find((i: any) => i.instance?.instanceName === ch.external_id)
              : null;
            number = instance?.instance?.ownerJid?.replace('@s.whatsapp.net', '') ?? null;
            if (number) {
              await (this.prisma as any).channel.update({ where: { id: ch.id }, data: { number, status } });
            }
          }
        } catch {
          status = 'disconnected';
        }
        return { ...ch, status, number };
      }
      return ch;
    }));

    return enriched;
  }

  async patchChannel(channelId: string, tenantId: string, body: Record<string, any>) {
    const channel = await (this.prisma as any).channel.findFirst({
      where: { id: channelId, tenant_id: tenantId },
    });
    if (!channel) throw new Error('Canal no encontrado');

    return (this.prisma as any).channel.update({
      where: { id: channelId },
      data: {
        routing_type:           body.routing_type           ?? null,
        routing_agent_id:       body.routing_agent_id       ?? null,
        routing_user_id:        body.routing_user_id        ?? null,
        routing_forward_number: body.routing_forward_number ?? null,
      },
    });
  }

  // ─── Conversations (unified audit log) ────────────────────────────────────

  async getConversations(tenantId: string) {
    const convs = await this.prisma.botConversation.findMany({
      where: { tenant_id: tenantId },
      include: {
        messages: { orderBy: { created_at: 'desc' }, take: 1 },
      },
      orderBy: { last_message_at: 'desc' },
      take: 100,
    });

    // Build channel map for routing info
    const dbChannels = await (this.prisma as any).channel.findMany({
      where: { tenant_id: tenantId },
    });
    const channelMap = new Map<string, any>(dbChannels.map((c: any) => [c.external_id, c] as [string, any]));

    // Resolve agent/user names for routing labels
    const agentIds = dbChannels.map((c: any) => c.routing_agent_id).filter(Boolean) as string[];
    const userIds  = dbChannels.map((c: any) => c.routing_user_id).filter(Boolean) as string[];
    const [agentSlots, userSlots] = await Promise.all([
      agentIds.length > 0 ? this.prisma.teamSlot.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : [],
      userIds.length > 0  ? this.prisma.teamSlot.findMany({ where: { id: { in: userIds  } }, select: { id: true, name: true } }) : [],
    ]);
    const agentMap = new Map<string, string>(agentSlots.map(a => [a.id, a.name] as [string, string]));
    const userMap  = new Map<string, string>(userSlots.map(u  => [u.id, u.name] as [string, string]));

    return convs.map(c => {
      const ch = channelMap.get(c.instance_name);
      const lastMsg = c.messages[0];

      let routed_type = 'agent';
      let routed_to   = 'Agente IA';
      if (ch?.routing_type === 'user' && ch.routing_user_id) {
        routed_type = 'user';
        routed_to   = userMap.get(ch.routing_user_id) ?? 'Asesor';
      } else if (ch?.routing_type === 'forward' && ch.routing_forward_number) {
        routed_type = 'forward';
        routed_to   = ch.routing_forward_number;
      } else if (ch?.routing_agent_id) {
        routed_to = agentMap.get(ch.routing_agent_id) ?? 'Agente IA';
      }

      return {
        id:              c.id,
        contact_name:    c.contact_name ?? c.phone,
        contact_number:  c.phone,
        channel:         ch?.type ?? 'whatsapp',
        channel_name:    ch?.name ?? c.instance_name,
        routed_type,
        routed_to,
        status:          c.mode === 'HUMAN' ? 'waiting' : 'active',
        last_message:    lastMsg?.content?.slice(0, 120) ?? '',
        time_ago:        formatTimeAgo(c.last_message_at ?? c.created_at),
        message_count:   c.messages.length,
      };
    });
  }

  async getConversationDetail(tenantId: string, conversationId: string) {
    const conv = await this.prisma.botConversation.findFirst({
      where: { id: conversationId, tenant_id: tenantId },
      include: { messages: { orderBy: { created_at: 'asc' } } },
    });
    if (!conv) throw new Error('Conversación no encontrada');

    const ch = await (this.prisma as any).channel.findFirst({
      where: { tenant_id: tenantId, external_id: conv.instance_name },
    });

    let routed_type = 'agent';
    let routed_to   = 'Agente IA';
    if (ch?.routing_type === 'user' && ch.routing_user_id) {
      const user = await this.prisma.teamSlot.findUnique({ where: { id: ch.routing_user_id }, select: { name: true } });
      routed_type = 'user';
      routed_to   = user?.name ?? 'Asesor';
    } else if (ch?.routing_type === 'forward' && ch.routing_forward_number) {
      routed_type = 'forward';
      routed_to   = ch.routing_forward_number;
    } else if (ch?.routing_agent_id) {
      const agent = await this.prisma.teamSlot.findUnique({ where: { id: ch.routing_agent_id }, select: { name: true } });
      routed_to = agent?.name ?? 'Agente IA';
    }

    return {
      id:             conv.id,
      contact_name:   conv.contact_name ?? conv.phone,
      contact_number: conv.phone,
      channel:        ch?.type ?? 'whatsapp',
      channel_name:   ch?.name ?? conv.instance_name,
      routed_type,
      routed_to,
      status:         conv.mode === 'HUMAN' ? 'waiting' : 'active',
      started_at:     conv.created_at.toISOString(),
      messages:       conv.messages.map((m: any) => ({
        id:         m.id,
        role:       m.role === 'user' ? 'contact' : m.role === 'assistant' ? 'agent' : 'human',
        content:    m.content,
        created_at: m.created_at.toISOString(),
      })),
    };
  }

  // ─── Legacy methods (unchanged) ───────────────────────────────────────────

  async getContacts(tenantId: string, search?: string, typeFilter?: string) {
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

    return [
      ...employees.map(e => ({
        id: e.id, name: e.name, type: 'employee' as const,
        phone: e.whatsapp_phone ?? e.email ?? '—',
        status: 'active', role: e.agent_role ?? undefined, source: 'teamslot' as const,
      })),
      ...crmContacts.map(c => ({
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || 'Sin nombre',
        type: c.status === 'customer' ? 'client' as const : 'lead' as const,
        phone: c.phone ?? '—', status: 'active' as const,
        role: c.company ?? undefined, source: 'contact' as const,
      })),
    ];
  }

  async getRouting(tenantId: string) {
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
      { type: 'employee', label: 'Empleados', description: 'Números registrados como empleados en el Directorio.', agentLabel: hosAgent?.name ?? 'Asistente Personal (HOS)', agentConnected: !!hosAgent, fallbackMessage: 'Hola {nombre}, ¿en qué te puedo ayudar?', active: true },
      { type: 'client',   label: 'Clientes',  description: 'Números registrados como clientes activos en el Directorio.', agentLabel: customerAgent?.name ?? null, agentConnected: !!customerAgent, fallbackMessage: 'Recibimos tu mensaje. Un asesor te atenderá en breve.', active: true },
      { type: 'unknown',  label: 'Desconocidos / Leads', description: 'Cualquier número que no esté registrado en el Directorio.', agentLabel: prospectingAgent?.name ?? null, agentConnected: !!prospectingAgent, fallbackMessage: 'Gracias por escribirnos. En breve te atendemos.', active: true },
    ];
  }

  async getSalesAgentConfig(tenantId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'sales' },
      select: { id: true, name: true, agent_config: true },
    });
    if (!slot) {
      return { configured: false, nombre: null, actividad: null, propuesta_valor: null, gancho: null, preguntas_calificacion: [], preguntas_microdiagnostico: [], criterios_buen_lead: null, criterios_mal_lead: null, cierre_calificado: null, cierre_no_calificado: null, cal_booking_url: null, evolution_instance: null };
    }
    const cfg = (slot.agent_config as Record<string, any>) ?? {};
    return {
      configured: true, slotId: slot.id,
      nombre: cfg.nombre ?? slot.name,
      actividad: cfg.actividad ?? null, propuesta_valor: cfg.propuesta_valor ?? null,
      gancho: cfg.gancho ?? null, mision: cfg.mision ?? null, enfoque: cfg.enfoque ?? null,
      tarea_seguimiento: cfg.tarea_seguimiento ?? null,
      preguntas_calificacion: cfg.preguntas_calificacion ?? [],
      preguntas_microdiagnostico: cfg.preguntas_microdiagnostico ?? [],
      criterios_buen_lead: cfg.criterios_buen_lead ?? null, criterios_mal_lead: cfg.criterios_mal_lead ?? null,
      cierre_calificado: cfg.cierre_calificado ?? null, cierre_no_calificado: cfg.cierre_no_calificado ?? null,
      cal_booking_url: cfg.cal_booking_url ?? null, evolution_instance: cfg.evolution_instance ?? null,
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
      type: 'AI_AGENT' as const, agent_role: 'sales', tenant_id: tenantId,
      name: body.nombre ?? 'Agente de Ventas',
      agent_config: {
        nombre: body.nombre ?? 'Agente de Ventas', actividad: body.actividad ?? null,
        propuesta_valor: body.propuesta_valor ?? null, gancho: body.gancho ?? null,
        mision: body.mision ?? null, enfoque: body.enfoque ?? null,
        tarea_seguimiento: body.tarea_seguimiento ?? null,
        preguntas_calificacion: body.preguntas_calificacion ?? [],
        preguntas_microdiagnostico: body.preguntas_microdiagnostico ?? [],
        criterios_buen_lead: body.criterios_buen_lead ?? null, criterios_mal_lead: body.criterios_mal_lead ?? null,
        cierre_calificado: body.cierre_calificado ?? null, cierre_no_calificado: body.cierre_no_calificado ?? null,
        cal_booking_url: body.cal_booking_url ?? null,
        journey: Array.isArray(body.journey) ? body.journey : [],
        evolution_instance: evolutionInstance,
        ai_provider: 'openrouter',
        model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4-5',
      },
    };

    if (existing) {
      await this.prisma.teamSlot.update({ where: { id: existing.id }, data: { name: agentData.name, agent_config: agentData.agent_config } });
    } else {
      await this.prisma.teamSlot.create({ data: agentData });
    }

    if (evolutionInstance) {
      const existingIntegration = await this.prisma.integration.findFirst({
        where: { tenant_id: tenantId, provider: 'whatsapp', config: { path: ['instance_name'], equals: evolutionInstance } },
        select: { id: true },
      });
      if (existingIntegration) {
        await this.prisma.integration.update({ where: { id: existingIntegration.id }, data: { status: 'connected', config: { instance_name: evolutionInstance } } });
      } else {
        await this.prisma.integration.create({ data: { tenant_id: tenantId, provider: 'whatsapp', status: 'connected', config: { instance_name: evolutionInstance } } });
      }

      const apiBase = process.env.API_PUBLIC_URL ?? 'https://api.flowdesk.mx';
      await this.evolution.setWebhook(evolutionInstance, `${apiBase}/api/v1/webhooks/evolution`).catch(() => {});

      // Auto-upsert Channel record so the conmutador sees this instance
      await (this.prisma as any).channel.upsert({
        where: { tenant_id_external_id: { tenant_id: tenantId, external_id: evolutionInstance } },
        create: { tenant_id: tenantId, type: 'whatsapp', external_id: evolutionInstance, name: 'WhatsApp — ' + (body.nombre ?? evolutionInstance), config_href: '/agents' },
        update: { name: 'WhatsApp — ' + (body.nombre ?? evolutionInstance) },
      });
    }

    return { ok: true };
  }
}

function formatTimeAgo(date: Date | null | undefined): string {
  if (!date) return '—';
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
