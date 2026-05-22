import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// Catálogo de integraciones disponibles en FlowDesk
export const INTEGRATION_CATALOG: Record<string, {
  provider: string;
  name: string;
  description: string;
  category: string;
  setup_url?: string;
  auto_provisioned?: boolean;
}> = {
  airtable: {
    provider: 'airtable',
    name: 'Airtable ERP',
    description: 'Base de datos empresarial con 5 tablas: CRM, Propuestas, Proyectos, Pagos e Interacciones. Se provisiona automáticamente durante el onboarding.',
    category: 'erp',
    auto_provisioned: true,
  },
  google: {
    provider: 'google',
    name: 'Google Workspace',
    description: 'Google Calendar, Gmail y Drive integrados con tu Desk. Agenda sincronizada y archivos accesibles desde FlowDesk.',
    category: 'productivity',
    setup_url: '/settings/integrations/google',
  },
  microsoft365: {
    provider: 'microsoft365',
    name: 'Microsoft 365',
    description: 'Outlook, Teams y OneDrive conectados. Ideal si tu equipo usa el ecosistema Microsoft.',
    category: 'productivity',
    setup_url: '/settings/integrations/microsoft365',
  },
  whatsapp: {
    provider: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Gestiona conversaciones de WhatsApp directamente desde FlowDesk. Requiere WhatsApp Business API.',
    category: 'communication',
    setup_url: '/settings/integrations/whatsapp',
  },
  gohighlevel: {
    provider: 'gohighlevel',
    name: 'GoHighLevel (GHL)',
    description: 'CRM y automatización de marketing. Sincroniza contactos, pipelines y automatizaciones con FlowDesk.',
    category: 'crm',
    setup_url: '/settings/integrations/ghl',
  },
  n8n: {
    provider: 'n8n',
    name: 'n8n Automations',
    description: 'Flujos de automatización avanzados conectados a FlowDesk. Ideal para integraciones personalizadas.',
    category: 'automation',
    setup_url: '/settings/integrations/n8n',
  },
  claude: {
    provider: 'claude',
    name: 'Anthropic Claude',
    description: 'Motor de IA para tus agentes internos. Ya incluido en FlowDesk — los agentes usan Claude por defecto.',
    category: 'ai',
    auto_provisioned: true,
  },
  chatwoot: {
    provider: 'chatwoot',
    name: 'Chatwoot',
    description: 'Plataforma de soporte al cliente multicanal. Centraliza WhatsApp, email y chat web.',
    category: 'communication',
    setup_url: '/settings/integrations/chatwoot',
  },
  stripe: {
    provider: 'stripe',
    name: 'Stripe',
    description: 'Cobros en línea y gestión de suscripciones integradas con tu ERP.',
    category: 'payments',
    setup_url: '/settings/integrations/stripe',
  },
  meta: {
    provider: 'meta',
    name: 'Meta (Instagram / Facebook)',
    description: 'Gestiona mensajes y leads de Instagram y Facebook desde FlowDesk.',
    category: 'social',
    setup_url: '/settings/integrations/meta',
  },
};

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

  // Estado completo de integraciones del tenant
  async getStatus(tenantId: string) {
    const connected = await this.prisma.integration.findMany({
      where: { tenant_id: tenantId, integration_scope: 'tenant' },
      select: { provider: true, status: true, connected_at: true, config: true, created_at: true },
    });

    const connectedMap = Object.fromEntries(connected.map(i => [i.provider, i]));

    // Verificar Airtable ERP (se guarda en campus_config, no en Integration)
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { campus_config: true },
    });
    const campusConfig = (tenant?.campus_config as any) ?? {};
    const airtableProvisioned = !!campusConfig.airtable_erp_base_id;

    return Object.entries(INTEGRATION_CATALOG).map(([key, catalog]) => ({
      key,
      provider:      catalog.provider,
      name:          catalog.name,
      description:   catalog.description,
      category:      catalog.category,
      setup_url:     catalog.setup_url,
      auto_provisioned: catalog.auto_provisioned ?? false,
      status: key === 'airtable'
        ? (airtableProvisioned ? 'connected' : 'pending')
        : key === 'claude'
          ? 'connected'
          : (connectedMap[catalog.provider]?.status ?? 'not_configured'),
      connected_at:  connectedMap[catalog.provider]?.connected_at ?? null,
    }));
  }

  // Registrar integraciones deseadas (desde onboarding o settings)
  async registerWishlist(tenantId: string, items: { provider: string; priority?: string; notes?: string }[]) {
    const results: any[] = [];
    for (const item of items) {
      const catalog = Object.values(INTEGRATION_CATALOG).find(c => c.provider === item.provider);
      if (!catalog || catalog.auto_provisioned) continue;

      try {
        const existing = await this.prisma.integration.findFirst({
          where: { tenant_id: tenantId, provider: item.provider },
        });

        if (existing) {
          results.push({ provider: item.provider, status: 'already_tracked' });
          continue;
        }

        await this.prisma.integration.create({
          data: {
            tenant_id:         tenantId,
            provider:          item.provider,
            integration_scope: 'tenant',
            status:            'disconnected',
            config: {
              priority:    item.priority ?? 'medium',
              notes:       item.notes ?? null,
              wishlist:    true,
              wishlist_at: new Date().toISOString(),
            },
          },
        });
        results.push({ provider: item.provider, name: catalog.name, status: 'registered' });
      } catch (e: any) {
        results.push({ provider: item.provider, error: e.message });
      }
    }
    return { ok: true, registered: results };
  }

  // Lista por categoría para el frontend
  async getCatalog() {
    return Object.entries(INTEGRATION_CATALOG).map(([key, c]) => ({ key, ...c }));
  }
}
