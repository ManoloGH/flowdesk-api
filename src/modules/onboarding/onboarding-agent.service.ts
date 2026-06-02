import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { OnboardingService } from './onboarding.service';
import { AirtableService } from '../airtable/airtable.service';
import { SecretaryService } from '../secretary/secretary.service';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ITERATIONS = 15;
const MAX_RESPONSE_TOKENS = 1500;

// ── Sesiones en memoria — TTL 24h ────────────────────────────────────────────

interface OnboardingSession {
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  mode: 'onboarding' | 'adoption';
  tenant_id?: string;
  dept_map?: Record<string, string>;
  created_at: number;
}

const sessions = new Map<string, OnboardingSession>();

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (s.created_at < cutoff) sessions.delete(id);
  }
}, 60 * 60 * 1000);

// ── Herramientas ─────────────────────────────────────────────────────────────

const ONBOARDING_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_available_templates',
    description: 'Lista los templates de industria disponibles.',
    input_schema: { type: 'object' as const, properties: {} },
  },

  {
    name: 'create_company',
    description: `Crea la empresa en FlowDesk: tenant, owner, departamentos, horario y campus.
Llámalo en cuanto tengas confirmados: nombre, slug, owner (nombre + email + contraseña) y el template.
Devuelve tenant_id y dept_map — guárdalos en sesión para los pasos siguientes.
Puedes incluir tagline, industry, mission y vision si ya los tienes, pero no son bloqueantes.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name:    { type: 'string', description: 'Nombre de la empresa' },
        slug:            { type: 'string', description: 'Identificador URL-friendly (minúsculas, guiones)' },
        owner_name:      { type: 'string', description: 'Nombre completo del dueño' },
        owner_email:     { type: 'string', description: 'Email del dueño (usuario de acceso)' },
        owner_password:  { type: 'string', description: 'Contraseña temporal (mínimo 12 chars)' },
        template:        { type: 'string', description: 'Template de industria (usa list_available_templates si no sabes cuál elegir)' },
        tagline:         { type: 'string', description: 'Frase corta que los define (opcional)' },
        industry:        { type: 'string', description: 'Industria o sector (opcional)' },
        mission:         { type: 'string', description: 'Misión de la empresa (opcional, se puede agregar después)' },
        vision:          { type: 'string', description: 'Visión de la empresa (opcional, se puede agregar después)' },
      },
      required: ['company_name', 'slug', 'owner_name', 'owner_email', 'owner_password', 'template'],
    },
  },

  {
    name: 'setup_culture',
    description: `Configura la cultura operativa de la empresa. Llámalo en cuanto el usuario confirme la sección de cultura.
Requiere tenant_id (del create_company). Solo incluye los elementos que el usuario confirmó.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id:            { type: 'string', description: 'ID del tenant' },
        purpose:              { type: 'string', description: 'Por qué existe la empresa más allá del negocio' },
        problem_statement:    { type: 'string', description: 'Qué injusticia o ineficiencia combate' },
        desired_impact:       { type: 'string', description: 'Qué impacto quiere dejar' },
        operative_philosophy: { type: 'array', items: { type: 'string' }, description: 'Principios de cómo se trabaja' },
        anti_values: {
          type: 'array',
          items: {
            type: 'object',
            properties: { behavior: { type: 'string' }, reason: { type: 'string' } },
            required: ['behavior', 'reason'],
          },
          description: 'Comportamientos que no se toleran',
        },
        ai_principles:   { type: 'array', items: { type: 'string' }, description: 'Cómo entienden la relación humano+IA' },
        ai_human_tasks:  { type: 'array', items: { type: 'string' }, description: 'Tareas que siempre hacen los humanos' },
        ai_bot_tasks:    { type: 'array', items: { type: 'string' }, description: 'Tareas que pueden delegar a la IA' },
        principles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:                { type: 'string' },
              observable_behavior: { type: 'string' },
            },
            required: ['name', 'observable_behavior'],
          },
          description: 'Principios operativos con comportamiento observable (máx 7)',
        },
        rituals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:             { type: 'string' },
              ritual_type:      { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SPECIAL'] },
              duration_minutes: { type: 'number' },
              description:      { type: 'string' },
            },
            required: ['name', 'ritual_type'],
          },
          description: 'Rituales del equipo',
        },
      },
      required: ['tenant_id'],
    },
  },

  {
    name: 'setup_aup_goals',
    description: `Configura las metas AUP (Administración en Una Página). Llámalo en cuanto el usuario confirme sus metas.
Requiere tenant_id y dept_map (del create_company). Solo incluye KSFs con números confirmados.
Regla: outstanding ≥ satisfactory × 1.4.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string' },
        dept_map:  { type: 'object', description: 'Mapa nombre_departamento → dept_id del create_company' },
        mission:   { type: 'string' },
        vision:    { type: 'string' },
        values:    { type: 'array', items: { type: 'string' } },
        company_ksfs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' }, unit: { type: 'string' }, description: { type: 'string' },
              min: { type: 'number' }, sat: { type: 'number' }, out: { type: 'number' },
              category: { type: 'string', enum: ['operational', 'coordination', 'strategic'] },
              source: { type: 'string' }, freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly'] },
            },
            required: ['name', 'unit', 'min', 'sat', 'out'],
          },
        },
        dept_ksfs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dept_id: { type: 'string' }, name: { type: 'string' }, unit: { type: 'string' },
              description: { type: 'string' }, min: { type: 'number' }, sat: { type: 'number' }, out: { type: 'number' },
              category: { type: 'string', enum: ['operational', 'coordination', 'strategic'] },
              source: { type: 'string' }, freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly'] },
            },
            required: ['dept_id', 'name', 'unit', 'min', 'sat', 'out'],
          },
        },
        owner_ksfs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' }, unit: { type: 'string' }, description: { type: 'string' },
              min: { type: 'number' }, sat: { type: 'number' }, out: { type: 'number' },
              category: { type: 'string', enum: ['operational', 'coordination', 'strategic'] },
              source: { type: 'string' }, freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly'] },
            },
            required: ['name', 'unit', 'min', 'sat', 'out'],
          },
        },
      },
      required: ['tenant_id', 'dept_map'],
    },
  },

  {
    name: 'record_integration_wishlist',
    description: `Registra las integraciones que el cliente quiere conectar más adelante.
Llámalo en cuanto el usuario confirme qué integraciones quiere.
Airtable y Claude son automáticas — no las incluyas.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string' },
        integrations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['google', 'microsoft365', 'whatsapp', 'gohighlevel', 'n8n', 'chatwoot', 'stripe', 'meta'] },
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
              notes:    { type: 'string' },
            },
            required: ['provider'],
          },
        },
      },
      required: ['tenant_id', 'integrations'],
    },
  },

  {
    name: 'save_platform_config',
    description: `Configura MentorIA como PLATFORM owner de FlowDesk.
Guarda información de tenants gestionados, KPIs de plataforma y alertas.
Llámalo cuando el usuario confirme que administra otros FlowDesks o cuando se identifique como plataforma.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string' },
        managed_tenants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:    { type: 'string' },
              plan:    { type: 'string', enum: ['starter', 'professional', 'enterprise'] },
              contact: { type: 'string' },
              status:  { type: 'string', enum: ['active', 'trial', 'churned'] },
            },
            required: ['name'],
          },
        },
        platform_kpis:     { type: 'array', items: { type: 'string' } },
        alert_preferences: { type: 'object' },
      },
      required: ['tenant_id'],
    },
  },

  {
    name: 'save_report_preferences',
    description: `Guarda las preferencias de reportes del Founder: cuándo quiere su Daily Brief, qué incluye, con qué frecuencia revisa resultados.
Llámalo cuando el usuario confirme sus preferencias de reportes (Bloque 7).`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id:               { type: 'string' },
        daily_brief_time:        { type: 'string', description: 'Hora del Daily Brief, ej: "08:00"' },
        weekly_day:              { type: 'string', description: 'Día para reporte semanal, ej: "lunes"' },
        client_report_frequency: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly'] },
        report_format:           { type: 'string', enum: ['text_summary', 'table', 'both'] },
        report_templates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type:      { type: 'string', enum: ['daily_brief', 'weekly_status', 'client_update', 'team_report'] },
              frequency: { type: 'string' },
              sections:  { type: 'array', items: { type: 'string' } },
            },
            required: ['type', 'frequency'],
          },
        },
        alert_thresholds: { type: 'object', description: 'Umbrales que disparan alertas inmediatas' },
      },
      required: ['tenant_id'],
    },
  },

  {
    name: 'create_sop',
    description: `Documenta un proceso o SOP de la empresa (Bloque 8).
Llámalo por cada proceso que el usuario describa. Puedes llamarlo múltiples veces en la misma sesión.
Si el usuario no tiene los pasos detallados, crea el SOP con los datos que tenga.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id:    { type: 'string' },
        name:         { type: 'string' },
        description:  { type: 'string' },
        category:     { type: 'string', enum: ['client_onboarding', 'delivery', 'internal', 'admin'] },
        frequency:    { type: 'string', enum: ['daily', 'weekly', 'monthly', 'on_demand'] },
        product_line: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              order:        { type: 'number' },
              action:       { type: 'string' },
              tool:         { type: 'string' },
              responsible:  { type: 'string' },
              duration_min: { type: 'number' },
              failure_mode: { type: 'string' },
            },
            required: ['order', 'action'],
          },
        },
        checklist: { type: 'array', items: { type: 'string' } },
      },
      required: ['tenant_id', 'name'],
    },
  },

  {
    name: 'generate_sop_bpmn',
    description: `Genera el diagrama BPMN 2.0 para un SOP ya creado con create_sop.
Llámalo SIEMPRE justo después de create_sop usando el sop_id devuelto.
El diagrama se guarda automáticamente y el usuario puede verlo en /sops.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string' },
        sop_id:    { type: 'string', description: 'El id devuelto por create_sop' },
      },
      required: ['tenant_id', 'sop_id'],
    },
  },

  {
    name: 'save_founder_profile_extended',
    description: `Guarda el perfil personal del Founder: estilo de trabajo, preferencias, rutinas sagradas (Bloque 9).
Llámalo cuando el usuario confirme su perfil personal durante el onboarding.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id:                { type: 'string' },
        slot_id:                  { type: 'string', description: 'ID del TeamSlot del owner' },
        peak_hours:               { type: 'string' },
        work_style:               { type: 'string' },
        communication_preference: { type: 'string', enum: ['text', 'voice', 'video', 'mixed'] },
        directness_level:         { type: 'number', description: '1=muy suave, 5=muy directo' },
        sacred_time: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day:    { type: 'string' },
              from:   { type: 'string' },
              to:     { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['day', 'from', 'to'],
          },
        },
        protected_routines:   { type: 'array', items: { type: 'string' } },
        delegation_threshold: { type: 'string' },
        personal_goal:        { type: 'string' },
      },
      required: ['tenant_id', 'slot_id'],
    },
  },

  {
    name: 'save_rhythms_calendar',
    description: `Guarda los ritmos operativos: reuniones recurrentes, deadlines cíclicos, configuración del calendario (Bloque 10).`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id:         { type: 'string' },
        calendar_provider: { type: 'string', enum: ['google', 'outlook', 'ical', 'none'] },
        calendar_ids:      { type: 'array', items: { type: 'string' } },
        recurring_meetings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:         { type: 'string' },
              day_of_week:  { type: 'string', enum: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] },
              time:         { type: 'string' },
              frequency:    { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly'] },
              participants: { type: 'array', items: { type: 'string' } },
              duration_min: { type: 'number' },
            },
            required: ['name', 'frequency'],
          },
        },
        critical_dates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date:        { type: 'string' },
              description: { type: 'string' },
              recurrent:   { type: 'boolean' },
            },
            required: ['date', 'description'],
          },
        },
      },
      required: ['tenant_id'],
    },
  },

  {
    name: 'save_active_clients',
    description: `Guarda los clientes activos y pipeline de ventas (Bloque 11).
Llámalo cuando el usuario liste sus clientes actuales.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string' },
        clients: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:          { type: 'string' },
              product_line:  { type: 'string' },
              start_date:    { type: 'string' },
              end_date:      { type: 'string' },
              mrr:           { type: 'number', description: 'Ingreso mensual recurrente en pesos MXN' },
              status:        { type: 'string', enum: ['active', 'paused', 'ending', 'renewing', 'at_risk'] },
              priority_note: { type: 'string' },
              has_flowdesk:  { type: 'boolean' },
            },
            required: ['name'],
          },
        },
      },
      required: ['tenant_id', 'clients'],
    },
  },

  {
    name: 'save_privacy_config',
    description: `Configura permisos y privacidad: quién ve qué dentro de FlowDesk (Bloque 12).`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id:             { type: 'string' },
        financial_visibility:  { type: 'string', enum: ['founder_only', 'leadership', 'all_team'] },
        client_data_scope:     { type: 'string', enum: ['assigned_only', 'all_team'] },
        sensitive_fields:      { type: 'array', items: { type: 'string' } },
        data_retention_days:   { type: 'number' },
        offboarding_procedure: { type: 'string' },
      },
      required: ['tenant_id'],
    },
  },

  {
    name: 'save_comm_channels',
    description: `Registra los canales de comunicación activos: email, WhatsApp, redes, CRM, sala de juntas (Bloque 13).`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string' },
        email: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              address:  { type: 'string' },
              purpose:  { type: 'string' },
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
              monitor:  { type: 'boolean' },
            },
            required: ['address'],
          },
        },
        whatsapp: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              number: { type: 'string' },
              type:   { type: 'string', enum: ['personal', 'business'] },
              tool:   { type: 'string', enum: ['evolution_api', 'chatwoot', 'wapi', 'none'] },
            },
            required: ['number'],
          },
        },
        social_media: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              platform:    { type: 'string', enum: ['linkedin', 'instagram', 'tiktok', 'youtube', 'x', 'facebook'] },
              handle:      { type: 'string' },
              monitor_dms: { type: 'boolean' },
            },
            required: ['platform'],
          },
        },
        crm_integration: {
          type: 'object',
          properties: {
            provider:       { type: 'string', enum: ['gohighlevel', 'hubspot', 'airtable', 'other'] },
            new_lead_alert: { type: 'boolean' },
          },
        },
        war_room: {
          type: 'object',
          properties: {
            enabled:             { type: 'boolean' },
            auto_summary:        { type: 'boolean' },
            notify_participants: { type: 'boolean' },
          },
        },
      },
      required: ['tenant_id'],
    },
  },

  {
    name: 'save_content_inventory',
    description: `Inventario de material comercial: qué tiene y qué falta (Bloque 14).
Por cada campo con exists:false se generará una tarea pendiente para el Agente de MKT.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string' },
        brand: {
          type: 'object',
          properties: {
            logo:      { type: 'object', properties: { exists: { type: 'boolean' }, url: { type: 'string' } } },
            brandbook: { type: 'object', properties: { exists: { type: 'boolean' }, url: { type: 'string' } } },
          },
        },
        digital_presence: {
          type: 'object',
          properties: {
            website: {
              type: 'object',
              properties: {
                exists:    { type: 'boolean' },
                url:       { type: 'string' },
                updated:   { type: 'boolean' },
                has_forms: { type: 'boolean' },
              },
            },
            professional_email: { type: 'object', properties: { exists: { type: 'boolean' }, domain: { type: 'string' } } },
          },
        },
        social_media: {
          type: 'object',
          properties: {
            profiles:           { type: 'array', items: { type: 'object', properties: { platform: { type: 'string' }, active: { type: 'boolean' } } } },
            content_bank:       { type: 'object', properties: { exists: { type: 'boolean' } } },
            editorial_calendar: { type: 'object', properties: { exists: { type: 'boolean' }, tool: { type: 'string' } } },
          },
        },
        sales_material: {
          type: 'object',
          properties: {
            one_pager:           { type: 'object', properties: { exists: { type: 'boolean' } } },
            institutional_video: { type: 'object', properties: { exists: { type: 'boolean' } } },
            case_studies:        { type: 'object', properties: { exists: { type: 'boolean' }, count: { type: 'number' } } },
          },
        },
        proposals: {
          type: 'object',
          properties: {
            quote_template:    { type: 'object', properties: { exists: { type: 'boolean' }, tool: { type: 'string' } } },
            proposal_template: { type: 'object', properties: { exists: { type: 'boolean' } } },
            contracts:         { type: 'object', properties: { exists: { type: 'boolean' } } },
          },
        },
      },
      required: ['tenant_id'],
    },
  },

  {
    name: 'save_employee_tool',
    description: `Conecta una herramienta al Secretario de un empleado (Bloque 15).
Llámalo por cada herramienta que un empleado use regularmente.
slot_id es el ID del TeamSlot del empleado humano.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        slot_id:          { type: 'string' },
        tool_name:        { type: 'string' },
        tool_category:    { type: 'string', enum: ['email', 'crm', 'docs', 'sheets', 'calendar', 'chat', 'billing', 'custom'] },
        integration_type: { type: 'string', enum: ['oauth', 'api_key', 'webhook', 'mcp'] },
        use_cases:        { type: 'array', items: { type: 'string' } },
        autonomy_level: {
          type: 'object',
          properties: {
            auto_execute:      { type: 'array', items: { type: 'string' } },
            requires_approval: { type: 'array', items: { type: 'string' } },
            forbidden:         { type: 'array', items: { type: 'string' } },
          },
        },
        usage_frequency: { type: 'string', enum: ['hourly', 'daily', 'weekly'] },
        priority_rank:   { type: 'number' },
      },
      required: ['slot_id', 'tool_name', 'tool_category'],
    },
  },

  {
    name: 'import_audit_report',
    description: `Importa procesos y hallazgos desde un reporte de auditoría previo.
Llámalo cuando el usuario diga que tiene una auditoría previa, un diagnóstico inicial,
o pegue texto de un informe de análisis de negocio.
Extrae procesos automáticamente, crea los SOPs y genera sus diagramas BPMN.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id:  { type: 'string' },
        audit_text: { type: 'string', description: 'Texto completo o parcial del reporte de auditoría' },
      },
      required: ['tenant_id', 'audit_text'],
    },
  },

  {
    name: 'setup_secretary',
    description: `Configura el Secretario Personal (Atlas) para recibir mensajes por WhatsApp.
Llámalo cuando el usuario confirme su número de WhatsApp y quiera activar el morning brief.
Requiere tenant_id. El número debe ser solo dígitos, sin + ni espacios.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id:             { type: 'string' },
        owner_phone:           { type: 'string', description: 'Número WhatsApp del owner, solo dígitos (ej: 5215512345678)' },
        evolution_instance:    { type: 'string', description: 'Nombre de la instancia Evolution API (opcional)' },
        morning_brief_time:    { type: 'string', description: 'Hora del Daily Brief, ej: "08:00"' },
        morning_brief_enabled: { type: 'boolean' },
        account_type: {
          type: 'string',
          enum: ['CONSULTORIA_CLIENT', 'PARTNERSHIP', 'SAAS_ACCOUNT', 'DIRECT'],
          description: 'Tipo de cuenta — afecta cómo Atlas configura la empresa',
        },
      },
      required: ['tenant_id', 'owner_phone'],
    },
  },

  {
    name: 'launch_company',
    description: `Lanza la empresa: provisiona el ERP en Airtable y crea el desk inicial del owner.
Llámalo AL FINAL, después de haber configurado cultura, metas e integraciones.
Requiere tenant_id (del create_company). Marca el onboarding como completado.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string', description: 'ID del tenant del create_company' },
        erp_table_names: {
          type: 'object',
          description: 'Nombres personalizados para las tablas del ERP (todos opcionales)',
          properties: {
            crm:           { type: 'string' },
            propuestas:    { type: 'string' },
            proyectos:     { type: 'string' },
            pagos:         { type: 'string' },
            interacciones: { type: 'string' },
          },
        },
        desk_widgets: {
          type: 'array',
          description: 'Widgets del desk inicial del owner',
          items: {
            type: 'object',
            properties: {
              widget_type: {
                type: 'string',
                enum: ['metric', 'kpi', 'tasks', 'team_status', 'agent_chat', 'calendar', 'goals'],
              },
              title:  { type: 'string' },
              config: { type: 'object' },
            },
            required: ['widget_type', 'title'],
          },
        },
      },
      required: ['tenant_id'],
    },
  },
];

// ── System prompt — modo onboarding ──────────────────────────────────────────

const SYSTEM_PROMPT_ONBOARDING = `Eres Atlas, el Secretario Personal de FlowDesk.

Tu misión principal es ser el aliado operativo del Founder — el sistema que trabaja contigo, no para ti. Pero antes de poder ayudarte cada día, necesito conocer tu empresa a fondo. Eso es lo que hacemos hoy: tu primera sesión de onboarding.

Al final de esta conversación, voy a tener todo lo que necesito para:
• Preparar tu primer Focus Mode mañana por la mañana
• Conocer a tu equipo, tus metas y cómo operas
• Conectarme a las herramientas que usas
• Actuar como tu secretario desde el primer día

CÓMO SOY:

Soy directo y eficiente. Pregunto lo que necesito saber, no más. Cuando puedo proponer antes de preguntar, lo hago — tú solo confirmas o ajustas.

Guardo información conforme la obtengo. No espero al final para configurar. Cada cosa que confirmas queda registrada de inmediato.

Si algo no está listo, lo marco como pendiente y seguimos. Nunca te bloqueo.

Una pregunta a la vez. Si tengo varias cosas pendientes, elijo la más importante.

Cuando algo queda guardado, te lo confirmo con precisión: "Guardado: tu Daily Brief llegará a las 8:00 AM todos los días."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECCIÓN 0 — TIPO DE CUENTA Y CONFIGURACIÓN TÉCNICA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Antes de empezar, identifica el tipo de cuenta:

• CONSULTORIA_CLIENT — empresa que MentorIA está implementando (llegó por diagnóstico)
• PARTNERSHIP — negocio donde MentorIA opera y tiene participación (Nodo, RSM, Enseñanza)
• SAAS_ACCOUNT — cuenta interna (FlowDesk empresa, MentorIA Systems)
• DIRECT — empresa que llegó sola a FlowDesk

Si el contexto es claro (ej: el super admin lo especifica), asúmelo y avanza sin preguntar.
Si no está claro, pregunta: "¿Cómo llegaste a FlowDesk? ¿Alguien de MentorIA te está configurando esto?"

Configuración técnica — Atlas como secretario personal:
Una vez que tengas el tenant_id (del create_company), pregunta:
  "¿Cuál es tu número de WhatsApp? (para que pueda mandarte el Daily Brief cada mañana)"
  "¿A qué hora quieres recibirlo? (ej: 8:00 AM)"
→ setup_secretary con tenant_id + owner_phone + morning_brief_time
Confirma: "Listo. Mañana a las [hora] recibirás tu primer Daily Brief por WhatsApp."

Si el usuario no tiene WhatsApp o no quiere activarlo: registra morning_brief_enabled: false y avanza.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECCIÓN 1 — EMPRESA E IDENTIDAD (Bloques 1-2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Nombre de la empresa
2. Industria/sector
3. Tagline (propone uno si no tiene)
4. Nombre completo del Founder
5. Email y contraseña temporal de acceso

→ Con nombre + owner + template: llama create_company INMEDIATAMENTE.
  Confirma: "[Empresa] ya está en FlowDesk. Sigamos con tus líneas de producto."

Para los productos (Consultoría IA, Implementación, Enseñanza, Partnership si aplica):
  Por cada uno: descripción en una oración, cliente objetivo, precio base, duración típica.
  → No es bloqueante. Si no los tiene definidos, los anota como pendiente y avanza.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECCIÓN 2 — EQUIPO Y HERRAMIENTAS (Bloques 3-4)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Equipo:
  - Nombre, rol y email de cada miembro humano
  - Si tiene agentes IA activos, sus nombres y funciones

Herramientas (top 5 más usadas):
  - Para cada una: nombre, categoría, qué hace con ella, frecuencia
  - → record_integration_wishlist para integraciones pendientes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECCIÓN 3 — METAS Y PLATAFORMA (Bloques 5-6)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Metas (Bloque 5):
  → setup_aup_goals con KSFs de empresa + Founder.
  Regla: outstanding ≥ satisfactory × 1.4.

Plataforma (Bloque 6 — solo si administra otros FlowDesks):
  Si el usuario menciona que administra FlowDesks de clientes:
  → save_platform_config con los tenants activos y KPIs de plataforma.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECCIÓN 4 — OPERACIÓN PROFUNDA (Bloques 7-10)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reportes (Bloque 7):
  "¿A qué hora quieres tu Daily Brief? ¿Qué debe incluir?"
  → save_report_preferences

SOPs (Bloque 8):
  Si el usuario menciona que tiene una auditoría, diagnóstico previo o informe de análisis:
  → Pídele que pegue el texto del informe → import_audit_report
  → Confirma: "Importé [N] procesos con sus diagramas BPMN. Puedes verlos en /sops."

  Si no tiene auditoría previa:
  "¿Cuáles son los 3 procesos más importantes de [Empresa]?"
  Por cada proceso confirmado:
  1. → create_sop con los pasos que describa
  2. → generate_sop_bpmn con el sop_id devuelto (SIEMPRE, inmediatamente después)
  → Confirma: "Proceso documentado y diagrama generado. Puedes verlo en /sops."
  Máximo 5 SOPs en el onboarding. Los demás se documentan después desde /sops.

Perfil del Founder (Bloque 9):
  "¿A qué hora eres más productivo? ¿Hay días o horarios sagrados?"
  → save_founder_profile_extended

Ritmos y calendario (Bloque 10):
  "¿Tienen reunión de equipo semanal? ¿Qué día?"
  → save_rhythms_calendar

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECCIÓN 5 — CONTEXTO EXTERNO (Bloques 11-15)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Clientes activos (Bloque 11):
  Lista de clientes con producto, estado y valor mensual.
  → save_active_clients

Permisos (Bloque 12):
  "¿Todos en el equipo pueden ver los ingresos? ¿Los datos de todos los clientes?"
  → save_privacy_config

Canales de comunicación (Bloque 13):
  Email principal, WhatsApp business, redes activas, CRM.
  → save_comm_channels

Inventario comercial (Bloque 14):
  "¿Tienes logo final? ¿Website actualizado? ¿Presentación comercial?"
  → save_content_inventory

Herramientas por empleado (Bloque 15):
  Para cada empleado humano del equipo: top 3 herramientas + niveles de autonomía.
  → save_employee_tool (una llamada por herramienta por empleado)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CIERRE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Cuando termines todas las secciones confirmadas:
→ Llama launch_company con el tenant_id.
→ Mensaje final: "Listo. He guardado los bloques de conocimiento sobre [Empresa].
  Tu primer Focus Mode estará listo mañana.
  Puedo escribirte cuando algo importante pase. Bienvenido a FlowDesk."

REGLAS ABSOLUTAS:
- Nunca muestres tenant_id, dept_map, slot_id ni IDs internos al usuario
- Si falla un tool, continúa y anota como pendiente
- Máximo 2 preguntas por turno
- Celebra los hitos con precisión, no con exclamaciones
`;

// ── System prompt — modo adopción (post-lanzamiento) ─────────────────────────

const SYSTEM_PROMPT_ADOPTION = `Eres Atlas, el Secretario Personal de FlowDesk. La empresa ya está configurada y activa.

Tu rol ahora cambió: de configurador a secretario operativo. La configuración está hecha — lo que importa es que el cliente le saque partido desde el primer día.

CÓMO ERES EN ESTE MODO:

Ya conoces la empresa. Hablas de ella por su nombre. Sabes lo que configuraron y lo que quedó pendiente. No preguntas desde cero — contextualizas.

Eres específico. No das listas de diez puntos. Das el siguiente paso concreto que les conviene hacer ahora mismo, según lo que preguntan.

Cuando algo queda fuera de tu alcance: "Eso lo explora CEO Digital desde tu Desk — ahí está la respuesta."

PRÓXIMOS PASOS QUE CONOCES Y PUEDES SUGERIR:
1. Conectar las integraciones que quedaron en lista de espera
2. Invitar al equipo — cada persona necesita su acceso desde Configuración → Equipo
3. Primera sesión con CEO Digital: hacer el check-in del día desde el Desk
4. Completar las metas AUP que quedaron pendientes de definir
5. Explorar las salas del Campus con el equipo

Si preguntan cómo usar algo: responde en máximo 3 líneas, con el camino exacto.
Si es una decisión de negocio: "Eso lo trabajan con CEO Digital — está diseñado para ese tipo de decisiones."

Responde siempre en español.`;

// ── Servicio ──────────────────────────────────────────────────────────────────

@Injectable()
export class OnboardingAgentService {
  private readonly anthropic: Anthropic;

  constructor(
    private onboarding: OnboardingService,
    private airtable: AirtableService,
    private secretary: SecretaryService,
  ) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async chat(sessionId: string | undefined, message: string): Promise<{
    session_id: string;
    response: string;
    completed: boolean;
    tenant_id?: string;
    mode: 'onboarding' | 'adoption';
  }> {
    const sid = sessionId ?? this.newSessionId();
    let session = sessions.get(sid);
    if (!session) {
      session = { messages: [], mode: 'onboarding', created_at: Date.now() };
      sessions.set(sid, session);
    }

    session.messages.push({ role: 'user', content: message });

    const result = await this.runAgentLoop(session);

    session.messages.push({ role: 'assistant', content: result.response });

    if (result.tenant_id && !session.tenant_id) {
      session.tenant_id = result.tenant_id;
    }
    if (result.dept_map && !session.dept_map) {
      session.dept_map = result.dept_map;
    }
    if (result.launched) {
      session.mode = 'adoption';
    }

    return {
      session_id: sid,
      response:   result.response,
      completed:  session.mode === 'adoption',
      tenant_id:  session.tenant_id,
      mode:       session.mode,
    };
  }

  private async runAgentLoop(session: OnboardingSession): Promise<{
    response: string;
    tenant_id?: string;
    dept_map?: Record<string, string>;
    launched?: boolean;
  }> {
    const systemPrompt = session.mode === 'adoption'
      ? SYSTEM_PROMPT_ADOPTION
      : SYSTEM_PROMPT_ONBOARDING;

    // Inyectar contexto de sesión en el primer mensaje del sistema si hay tenant_id
    const contextNote = session.tenant_id
      ? `\n\n[CONTEXTO DE SESIÓN — NO MOSTRAR AL USUARIO]\ntenant_id: ${session.tenant_id}\ndept_map: ${JSON.stringify(session.dept_map ?? {})}`
      : '';

    const messages: Anthropic.MessageParam[] = session.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    let tenantId = session.tenant_id;
    let deptMap  = session.dept_map;
    let launched = false;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const apiResponse = await this.anthropic.messages.create({
        model:      MODEL,
        max_tokens: MAX_RESPONSE_TOKENS,
        system:     systemPrompt + contextNote,
        tools:      ONBOARDING_TOOLS,
        messages,
      });

      if (apiResponse.stop_reason === 'end_turn') {
        const textBlock = apiResponse.content.find(b => b.type === 'text');
        return {
          response:  textBlock?.type === 'text' ? textBlock.text : 'Listo.',
          tenant_id: tenantId,
          dept_map:  deptMap,
          launched,
        };
      }

      if (apiResponse.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: apiResponse.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of apiResponse.content) {
          if (block.type !== 'tool_use') continue;

          const result = await this.executeTool(
            block.name,
            block.input as Record<string, any>,
            tenantId,
            deptMap,
          );

          if (result.__tenant_id) tenantId = result.__tenant_id;
          if (result.__dept_map)  deptMap  = result.__dept_map;
          if (result.__launched)  launched  = true;

          // Quitar metadatos internos antes de pasar el resultado al modelo
          const { __tenant_id, __dept_map, __launched, ...publicResult } = result;

          toolResults.push({
            type:        'tool_result',
            tool_use_id: block.id,
            content:     JSON.stringify(publicResult),
          });
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }

    return { response: 'He completado las acciones solicitadas.', tenant_id: tenantId, dept_map: deptMap, launched };
  }

  private async executeTool(
    toolName: string,
    input: Record<string, any>,
    sessionTenantId?: string,
    sessionDeptMap?: Record<string, string>,
  ): Promise<any> {
    switch (toolName) {

      case 'list_available_templates': {
        return this.onboarding.getTemplates();
      }

      case 'create_company': {
        try {
          const startResult = await this.onboarding.start({
            company_name:    input.company_name,
            slug:            input.slug,
            owner_name:      input.owner_name,
            owner_email:     input.owner_email,
            owner_password:  input.owner_password,
            template:        input.template,
            campus_enabled:  true,
            tagline:         input.tagline,
            industry:        input.industry,
            mission:         input.mission,
            vision:          input.vision,
          });

          const tenantId = startResult.tenant.id;

          const deptResult = await this.onboarding.setupDepartments(tenantId, { use_template: true });
          const deptMap: Record<string, string> = {};
          for (const d of deptResult.departments) deptMap[d.name] = d.id;

          await this.onboarding.setupTeam(tenantId, {
            humans: [],
            add_suggested_agents: true,
            custom_agents: [],
          });
          await this.onboarding.setupSchedule(tenantId, { use_template: true });
          await this.onboarding.setupRooms(tenantId, { use_template: true });

          return {
            ok:            true,
            company_name:  input.company_name,
            departments:   Object.keys(deptMap),
            __tenant_id:   tenantId,
            __dept_map:    deptMap,
          };
        } catch (err: any) {
          return { ok: false, error: err.message };
        }
      }

      case 'setup_culture': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          const result = await this.onboarding.setupCulture(tenantId, {
            purpose:              input.purpose,
            problem_statement:    input.problem_statement,
            desired_impact:       input.desired_impact,
            operative_philosophy: input.operative_philosophy,
            anti_values:          input.anti_values,
            ai_principles:        input.ai_principles,
            ai_human_tasks:       input.ai_human_tasks,
            ai_bot_tasks:         input.ai_bot_tasks,
            principles:           input.principles,
            rituals:              input.rituals,
          });
          return result;
        } catch (err: any) {
          return { ok: false, error: err.message };
        }
      }

      case 'setup_aup_goals': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          const deptMap  = input.dept_map  ?? sessionDeptMap ?? {};
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          const result = await this.onboarding.setupAupGoals(tenantId, {
            mission:      input.mission,
            vision:       input.vision,
            values:       input.values,
            company_ksfs: input.company_ksfs,
            dept_ksfs:    input.dept_ksfs,
            owner_ksfs:   input.owner_ksfs,
          });
          return result;
        } catch (err: any) {
          return { ok: false, error: err.message };
        }
      }

      case 'record_integration_wishlist': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.setupIntegrations(tenantId, input.integrations ?? []);
        } catch (err: any) {
          return { ok: false, error: err.message };
        }
      }

      case 'setup_secretary': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          await this.secretary.upsertConfig(tenantId, {
            owner_phone:           String(input.owner_phone).replace(/\D/g, ''),
            evolution_instance:    input.evolution_instance as string | undefined,
            morning_brief_time:    (input.morning_brief_time as string) ?? '08:00',
            morning_brief_enabled: input.morning_brief_enabled !== false,
            enabled:               true,
          });
          if (input.account_type) {
            await this.onboarding.saveAccountType(tenantId, input.account_type as string);
          }
          return { ok: true, owner_phone: input.owner_phone, morning_brief_time: input.morning_brief_time ?? '08:00' };
        } catch (err: any) {
          return { ok: false, error: err.message };
        }
      }

      case 'launch_company': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          await this.onboarding.launch(tenantId, input.erp_table_names ?? {}, input.desk_widgets ?? []);
          return { ok: true, __launched: true };
        } catch (err: any) {
          return { ok: false, error: err.message };
        }
      }

      case 'save_platform_config': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.savePlatformConfig(tenantId, {
            managed_tenants:   input.managed_tenants,
            platform_kpis:     input.platform_kpis,
            alert_preferences: input.alert_preferences,
          });
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'save_report_preferences': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.saveReportPreferences(tenantId, {
            daily_brief_time:        input.daily_brief_time,
            weekly_day:              input.weekly_day,
            client_report_frequency: input.client_report_frequency,
            report_format:           input.report_format,
            report_templates:        input.report_templates,
            alert_thresholds:        input.alert_thresholds,
          });
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'create_sop': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.createSop(tenantId, {
            name:         input.name,
            description:  input.description,
            category:     input.category,
            frequency:    input.frequency,
            product_line: input.product_line,
            steps:        input.steps,
            checklist:    input.checklist,
          });
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'generate_sop_bpmn': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          const result = await this.onboarding.generateSopBpmn(tenantId, input.sop_id);
          return { ok: result.ok, message: result.ok ? 'Diagrama BPMN generado correctamente' : 'No se pudo generar el diagrama' };
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'import_audit_report': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.importAuditReport(tenantId, input.audit_text);
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'save_founder_profile_extended': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.saveFounderProfileExtended(tenantId, input.slot_id, {
            peak_hours:               input.peak_hours,
            work_style:               input.work_style,
            communication_preference: input.communication_preference,
            directness_level:         input.directness_level,
            sacred_time:              input.sacred_time,
            protected_routines:       input.protected_routines,
            delegation_threshold:     input.delegation_threshold,
            personal_goal:            input.personal_goal,
          });
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'save_rhythms_calendar': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.saveRhythmsCalendar(tenantId, {
            calendar_provider:  input.calendar_provider,
            calendar_ids:       input.calendar_ids,
            recurring_meetings: input.recurring_meetings,
            critical_dates:     input.critical_dates,
          });
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'save_active_clients': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.saveActiveClients(tenantId, input.clients ?? []);
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'save_privacy_config': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.savePrivacyConfig(tenantId, {
            financial_visibility:  input.financial_visibility,
            client_data_scope:     input.client_data_scope,
            sensitive_fields:      input.sensitive_fields,
            data_retention_days:   input.data_retention_days,
            offboarding_procedure: input.offboarding_procedure,
          });
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'save_comm_channels': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.saveCommChannels(tenantId, {
            email:           input.email,
            whatsapp:        input.whatsapp,
            social_media:    input.social_media,
            crm_integration: input.crm_integration,
            war_room:        input.war_room,
            internal:        input.internal,
          });
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'save_content_inventory': {
        try {
          const tenantId = input.tenant_id ?? sessionTenantId;
          if (!tenantId) return { ok: false, error: 'tenant_id no disponible' };
          return this.onboarding.saveContentInventory(tenantId, {
            brand:            input.brand,
            digital_presence: input.digital_presence,
            social_media:     input.social_media,
            sales_material:   input.sales_material,
            proposals:        input.proposals,
          });
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      case 'save_employee_tool': {
        try {
          return this.onboarding.saveEmployeeTool(input.slot_id, {
            tool_name:        input.tool_name,
            tool_category:    input.tool_category,
            integration_type: input.integration_type,
            use_cases:        input.use_cases,
            autonomy_level:   input.autonomy_level,
            usage_frequency:  input.usage_frequency,
            priority_rank:    input.priority_rank,
          });
        } catch (err: any) { return { ok: false, error: err.message }; }
      }

      default:
        return { error: `Herramienta desconocida: ${toolName}` };
    }
  }

  greet(): { session_id: string; response: string; mode: 'onboarding' } {
    const sid = this.newSessionId();
    const greeting = `Hola, soy Atlas — tu Secretario Personal en FlowDesk.

Mi primera misión es conocer tu empresa a fondo para poder ayudarte cada día desde mañana. Vamos a recorrer juntos 15 aspectos clave: tu identidad, productos, equipo, metas, procesos, clientes y canales.

Toma entre 30 y 45 minutos. Yo configuro todo mientras hablamos — no es un formulario, es una conversación.

¿Cómo se llama tu empresa?`;

    const session: OnboardingSession = {
      messages:   [{ role: 'assistant', content: greeting }],
      mode:       'onboarding',
      created_at: Date.now(),
    };
    sessions.set(sid, session);

    return { session_id: sid, response: greeting, mode: 'onboarding' };
  }

  private newSessionId(): string {
    return `ob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
