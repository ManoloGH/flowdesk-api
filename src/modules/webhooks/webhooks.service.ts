import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AuditService, AuditAction } from '../../common/audit/audit.service';
import { ChatwootAdapter } from '../../integrations/chatwoot/chatwoot.adapter';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';
import { GhlAdapter } from '../../integrations/ghl/ghl.adapter';

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

      const parsed = this.evolution.processWebhook(payload);

      if (parsed.type === 'message' && parsed.from && parsed.content) {
        // Buscar o crear contacto
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

        // Registrar actividad
        await this.prisma.contactActivity.create({
          data: {
            contact_id: contact.id,
            tenant_id: tenantId,
            activity_type: 'message',
            content: parsed.content,
            metadata: { channel: 'whatsapp', instance: parsed.instance },
          },
        });

        // Notificar al campus
        messagesGateway?.deliverToTenant(tenantId, 'inbox:new_message', {
          source: 'whatsapp',
          channel: 'whatsapp',
          from: parsed.from,
          contact_id: contact.id,
          content: parsed.content?.slice(0, 80),
        });
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
        },
      });

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
}
