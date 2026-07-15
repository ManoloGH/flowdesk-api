import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AuditService, AuditAction } from '../../common/audit/audit.service';
import { ChatwootAdapter } from '../../integrations/chatwoot/chatwoot.adapter';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';
import { GhlAdapter } from '../../integrations/ghl/ghl.adapter';
import { SecretaryService } from '../secretary/secretary.service';
import { SecretaryAgentService } from '../secretary/secretary-agent.service';
import { WhatsAppService } from '../secretary/whatsapp.service';
import { WhatsAppRouterService } from '../whatsapp-channel/whatsapp-router.service';
import { EmployeeWhatsAppService } from '../whatsapp-channel/employee-whatsapp.service';
import { OperativeWhatsAppService } from '../whatsapp-channel/operative-whatsapp.service';
import { CustomerWhatsAppService } from '../whatsapp-channel/customer-whatsapp.service';
import { ChatwootBridgeService } from '../chatwoot-bridge/chatwoot-bridge.service';
import { SalesBotService } from '../whatsapp-channel/sales-bot.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
    private chatwoot: ChatwootAdapter,
    private evolution: EvolutionAdapter,
    private ghl: GhlAdapter,
    private secretary: SecretaryService,
    private secretaryAgent: SecretaryAgentService,
    private whatsapp: WhatsAppService,
    private waRouter: WhatsAppRouterService,
    private employeeWa: EmployeeWhatsAppService,
    private operativeWa: OperativeWhatsAppService,
    private customerWa: CustomerWhatsAppService,
    private chatwootBridge: ChatwootBridgeService,
    private salesBot: SalesBotService,
  ) {}

  // Resolver el tenant a partir del identificador del webhook
  async resolveTenant(identifier: string): Promise<string | null> {
    const integration = await this.prisma.integration.findFirst({
      where: {
        status: 'connected',
        OR: [
          { config: { path: ['account_id'], equals: identifier } },
          { config: { path: ['location_id'], equals: identifier } },
          { config: { path: ['instance_name'], equals: identifier } },
        ],
      },
    });
    return integration?.tenant_id ?? null;
  }

  // ─── Chatwoot ─────────────────────────────────────────────────────────────

  async handleChatwoot(payload: any, messagesGateway: any) {
    try {
      const accountId = String(payload.account?.id ?? '');
      const tenantId = await this.resolveTenant(accountId);
      if (!tenantId) {
        this.logger.warn(`Chatwoot webhook: tenant no encontrado para account ${accountId}`);
        return;
      }

      await this.chatwoot.processWebhook(payload, tenantId, messagesGateway);

      // Auto-respuesta IA para mensajes entrantes de clientes externos
      if (payload.event === 'message_created' && payload.message_type === 'incoming') {
        const conversationId = payload.conversation?.id;
        const message = payload.content;
        if (conversationId && message) {
          // No bloquear — responder en background
          this.chatwootBridge.handleIncomingMessage({
            conversationId,
            message,
            contactName: payload.conversation?.meta?.sender?.name,
            tenantId,
            channel: payload.conversation?.channel,
          }).catch(err => this.logger.error('ChatwootBridge error', err));
        }
      }

      // Emitir evento al campus para mostrar badge de mensaje entrante
      if (payload.event === 'message_created' && payload.message_type === 'incoming') {
        messagesGateway?.deliverToTenant(tenantId, 'inbox:new_message', {
          source: 'chatwoot',
          channel: payload.conversation?.channel ?? 'chat',
          contact_name: payload.conversation?.meta?.sender?.name,
          content: payload.content?.slice(0, 80),
          conversation_id: payload.conversation?.id,
        });
      }
    } catch (err) {
      this.logger.error('Error procesando webhook Chatwoot', err);
    }
  }

  // ─── Evolution API (WhatsApp) ─────────────────────────────────────────────

  async handleEvolution(payload: any, messagesGateway: any) {
    try {
      const instanceName = payload.instance ?? '';
      const tenantId = await this.resolveTenant(instanceName);
      if (!tenantId) {
        this.logger.warn(`Evolution webhook: tenant no encontrado para instancia ${instanceName}`);
        return;
      }

      // ── Detectar instancia del Agente de Ventas ──────────────────────────
      // Si el slot de ventas tiene evolution_instance configurada y coincide,
      // el mensaje va al SalesBotService (con su propio historial y tools).
      const salesSlot = await this.prisma.teamSlot.findFirst({
        where: {
          tenant_id: tenantId,
          type: 'AI_AGENT',
          agent_role: 'sales',
          agent_config: { path: ['evolution_instance'], equals: instanceName },
        },
        select: { id: true },
      });

      if (salesSlot) {
        const rawJid = payload.data?.key?.remoteJid ?? '';
        const rawMsg = payload.event === 'messages.upsert' && !payload.data?.key?.fromMe
          ? (payload.data?.message?.conversation ?? payload.data?.message?.extendedTextMessage?.text)
          : null;

        if (rawMsg && rawJid) {
          const phone = rawJid.replace(/@.+$/, '');
          const pushName = payload.data?.pushName;
          this.salesBot.handle({
            phone,
            jid: rawJid,
            message: rawMsg,
            contactName: pushName,
            tenantId,
            instanceName,
          }).catch(err => this.logger.error('SalesBot error', err));
        }
        return; // no continuar con routing normal
      }

      const parsed = this.evolution.processWebhook(payload);

      if (parsed.type === 'message' && parsed.from && parsed.content) {
        // Identificar quién escribe ANTES de hacer cualquier otra cosa
        const identity = await this.waRouter.identify(parsed.from, instanceName);
        const isInternal = identity.type === 'owner' || identity.type === 'employee' || identity.type === 'operative';

        // Solo crear/actualizar contacto CRM para mensajes externos (clientes, prospectos)
        if (!isInternal) {
          let contact = await this.prisma.contact.findFirst({
            where: { tenant_id: tenantId, phone: parsed.from },
          });

          if (!contact) {
            contact = await this.prisma.contact.create({
              data: {
                tenant_id: tenantId,
                first_name: parsed.from,
                phone: parsed.from,
                status: 'lead',
              },
            });
          } else {
            await this.prisma.contact.update({
              where: { id: contact.id },
              data: { last_contact_at: new Date() },
            });
          }

          await this.prisma.contactActivity.create({
            data: {
              contact_id: contact.id,
              tenant_id: tenantId,
              activity_type: 'message',
              content: parsed.content,
              metadata: { channel: 'whatsapp', instance: parsed.instance },
            },
          });

          // Notificar al campus solo para externos (inbox de atención)
          messagesGateway?.deliverToTenant(tenantId, 'inbox:new_message', {
            source: 'whatsapp',
            channel: 'whatsapp',
            from: parsed.from,
            contact_id: contact.id,
            content: parsed.content?.slice(0, 80),
          });
        }

        // ── Dispatch por identidad ──────────────────────────────────────────

        if (identity.type === 'owner') {
          const instance = await this.secretary.getEvolutionInstance(tenantId);
          if (instance) {
            const reply = this.secretaryAgent.hasActiveAgent(parsed.from)
              ? await this.secretaryAgent.chatWithActiveAgent(tenantId, parsed.from, parsed.content)
              : await this.secretaryAgent.chat(tenantId, parsed.content, parsed.from);
            await this.whatsapp.send(instance, parsed.from, reply);
          }

        } else if (identity.type === 'employee') {
          await this.employeeWa.handle({
            phone: parsed.from,
            message: parsed.content,
            tenantId,
            teamSlot: identity.teamSlot,
            instanceName,
          });

        } else if (identity.type === 'operative') {
          await this.operativeWa.handle({
            phone: parsed.from,
            message: parsed.content,
            tenantId,
            teamSlot: identity.teamSlot,
            instanceName,
          });

        } else {
          // Cliente externo → bot IA + Chatwoot
          await this.customerWa.handle({
            phone: parsed.from,
            message: parsed.content,
            tenantId,
            instanceName,
          });
        }
      }
    } catch (err) {
      this.logger.error('Error procesando webhook Evolution', err);
    }
  }

  // ─── GoHighLevel ──────────────────────────────────────────────────────────

  async handleGhl(payload: any, messagesGateway: any) {
    try {
      const locationId = payload.locationId ?? '';
      const tenantId = await this.resolveTenant(locationId);
      if (!tenantId) {
        this.logger.warn(`GHL webhook: tenant no encontrado para location ${locationId}`);
        return;
      }

      await this.ghl.processWebhook(payload, tenantId);

      // Notificar cambio de oportunidad al campus
      if (payload.type === 'OpportunityStageUpdate') {
        messagesGateway?.deliverToTenant(tenantId, 'crm:opportunity_update', {
          opportunity_id: payload.id,
          stage: payload.pipelineStageId,
          contact: payload.contact,
        });
      }

      if (payload.type === 'ContactCreate') {
        messagesGateway?.deliverToTenant(tenantId, 'crm:new_lead', {
          name: `${payload.firstName} ${payload.lastName ?? ''}`.trim(),
          phone: payload.phone,
          email: payload.email,
          source: 'ghl',
        });
      }
    } catch (err) {
      this.logger.error('Error procesando webhook GHL', err);
    }
  }

  // ─── Provisioning desde Airtable (Propuesta Ganada) ──────────────────────

  async provisionFromAirtable(secret: string, body: {
    airtable_record_id: string;
    company_name: string;
    owner_email: string;
    owner_name: string;
    external_ref?: string;
    plan?: string;
    tenant_type?: 'NETWORK' | 'BRANCH';
  }) {
    const expected = this.config.get<string>('FLOWDESK_WEBHOOK_SECRET');
    if (expected && secret !== expected) throw new ForbiddenException('Secret inválido.');

    const { company_name, owner_email, owner_name, external_ref, plan, tenant_type } = body;
    if (!company_name || !owner_email || !owner_name) throw new BadRequestException('Faltan campos requeridos.');

    // Generar slug único a partir del nombre de empresa
    const baseSlug = company_name
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar acentos
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40);

    // Verificar colisión y añadir sufijo si existe
    let slug = baseSlug;
    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) slug = `${baseSlug}-${Date.now().toString(36)}`;

    const type = tenant_type ?? 'NETWORK';
    const chosenPlan = plan ?? 'starter';

    const result = await this.prisma.$transaction(async (tx: any) => {
      const tenant = await tx.tenant.create({
        data: {
          name: company_name,
          slug,
          tenant_type: type,
          external_ref: external_ref ?? null,
          airtable_project_id: body.airtable_record_id,
          plan: chosenPlan,
          status: 'active',
          employee_desks_enabled: true,
        },
      });

      const ownerSlot = await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id,
          name: owner_name,
          email: owner_email,
          type: 'HUMAN',
          role: 'owner',
          status: 'OFFLINE',
          desk_access: 'FULL',
          agent_config: { worker_type: 'desk' }, // nivel Director
        },
      });

      // CEO Agent — estratégico
      await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id,
          name: 'Atlas',
          type: 'AI_AGENT',
          role: 'employee',
          status: 'ONLINE',
          agent_role: 'ceo',
          agent_scope: 'personal',
          owner_slot_id: ownerSlot.id,
          agent_config: {
            model: 'claude-sonnet-4-6',
            instructions: `Soy Atlas, CEO Agent personal de ${owner_name} en ${company_name}. Coordino tareas, agentes y objetivos para maximizar la productividad del equipo.`,
            tools: [],
          },
        },
      });

      // Daily Assistant — asistente diario (nivel Director)
      await tx.teamSlot.create({
        data: {
          tenant_id: tenant.id,
          name: `Asistente de ${owner_name}`,
          type: 'AI_AGENT',
          role: 'employee',
          status: 'ONLINE',
          agent_role: 'daily_assistant',
          agent_scope: 'personal',
          owner_slot_id: ownerSlot.id,
          agent_config: {
            model: 'claude-sonnet-4-6',
            level: 'Director',
            instructions: `Eres el asistente personal de ${owner_name} (Director) en ${company_name}. Coordinas su día, equipo y objetivos estratégicos.`,
            tools: [],
          },
        },
      });

      return { tenant, owner_slot_id: ownerSlot.id };
    });

    this.logger.log(`Tenant provisionado desde Airtable: ${slug} (${result.tenant.id})`);
    this.audit.log({
      tenantId: result.tenant.id,
      action: AuditAction.TENANT_PROVISIONED,
      resourceType: 'tenant',
      resourceId: result.tenant.id,
      payload: { company_name, owner_email, plan: chosenPlan, source: 'airtable', airtable_record_id: body.airtable_record_id },
    });

    return {
      ok: true,
      tenant_id: result.tenant.id,
      tenant_slug: slug,
      company_name,
      owner_slot_id: result.owner_slot_id,
      owner_email,
      plan: chosenPlan,
      airtable_record_id: body.airtable_record_id,
      desk_url: `https://app.flowdesk.io/desk/${slug}`,
    };
  }

  // ─── Migración: sistema de 4 niveles de empleados (idempotente) ──────────

  async migrateEmployeeStructure(secret: string, specificTenantId?: string) {
    const expected = this.config.get<string>('FLOWDESK_WEBHOOK_SECRET');
    if (expected && secret !== expected) throw new ForbiddenException('Secret inválido.');

    const tenants = specificTenantId
      ? await this.prisma.tenant.findMany({ where: { id: specificTenantId, status: 'active' }, select: { id: true, name: true } })
      : await this.prisma.tenant.findMany({ where: { status: 'active' }, select: { id: true, name: true } });

    const report: Array<{ tenant: string; slots_updated: number; assistants_created: number }> = [];

    for (const tenant of tenants) {
      let slots_updated = 0;
      let assistants_created = 0;

      // 1. Todos los slots humanos sin worker_type en agent_config
      const humanSlots = await this.prisma.teamSlot.findMany({
        where: { tenant_id: tenant.id, type: 'HUMAN' },
        select: { id: true, name: true, role: true, agent_config: true },
      });

      for (const slot of humanSlots) {
        const cfg = (slot.agent_config ?? {}) as Record<string, any>;

        // Solo actualizar si no tiene worker_type (idempotente)
        if (!cfg.worker_type) {
          await this.prisma.teamSlot.update({
            where: { id: slot.id },
            data: { agent_config: { ...cfg, worker_type: 'desk' } },
          });
          slots_updated++;
        }

        // 2. Provisionar daily_assistant si no tiene uno
        const hasAssistant = await this.prisma.teamSlot.findFirst({
          where: { tenant_id: tenant.id, type: 'AI_AGENT', owner_slot_id: slot.id, agent_role: 'daily_assistant' },
          select: { id: true },
        });

        if (!hasAssistant && (cfg.worker_type !== 'operative')) {
          const isDirector = ['owner', 'admin'].includes(slot.role);
          const isManager  = slot.role === 'manager';
          const level      = isDirector ? 'Director' : isManager ? 'Gerente' : 'Empleado';

          await this.prisma.teamSlot.create({
            data: {
              tenant_id: tenant.id,
              name: `Asistente de ${slot.name}`,
              type: 'AI_AGENT',
              role: 'employee',
              status: 'ONLINE',
              agent_role: 'daily_assistant',
              agent_scope: 'personal',
              owner_slot_id: slot.id,
              agent_config: {
                model: 'claude-sonnet-4-6',
                level,
                instructions: `Eres el asistente personal de ${slot.name} (${level}) en FlowDesk. Gestionas su día, tareas e indicadores.`,
                tools: [],
              },
            },
          });
          assistants_created++;
        }
      }

      report.push({ tenant: tenant.name, slots_updated, assistants_created });
      this.logger.log(`Migración ${tenant.name}: ${slots_updated} slots, ${assistants_created} asistentes`);
    }

    return {
      ok: true,
      tenants_processed: tenants.length,
      report,
      message: 'Migración completada. Todos los empleados tienen worker_type y daily_assistant.',
    };
  }
}
