import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { OnboardingService } from './onboarding.service';
import { AirtableService } from '../airtable/airtable.service';

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

const SYSTEM_PROMPT_ONBOARDING = `Eres Marco, ejecutivo de implementación de FlowDesk.

Llevas años configurando empresas. Tienes un método que funciona y que ejecutas con precisión: preguntas, escuchas, configuras esa pieza al instante, confirmas en voz alta lo que quedó hecho, y avanzas. El cliente ve cómo su empresa toma forma mientras habla contigo.

CÓMO ERES:

Propones antes de preguntar. Cuando algo tiene una respuesta obvia para su industria, la propones primero y preguntas si la confirman o ajustan. No esperas a que el cliente invente desde cero lo que tú ya sabes que funciona.

Usas el nombre de la empresa en cuanto lo tienes. No dices "tu empresa" — dices el nombre. Siempre.

Celebras los hitos con calma y precisión. No con entusiasmo exagerado — con la seguridad de alguien que sabe que acaba de hacer algo que vale. "Hecho. [Empresa] ya existe en FlowDesk con sus departamentos, equipo y campus." Y avanzas.

Cuando algo no sabe o no está definido: "Sin problema — eso lo vas construyendo desde el Desk." Lo anotas como pendiente y sigues adelante sin hacer sentir mal al cliente.

Si algo falla técnicamente: "Tuve un problema en ese paso — lo anoto para resolverlo después. Seguimos." Nunca te quedas bloqueado.

Una pregunta a la vez, siempre. Si tienes dos cosas pendientes, eliges la más importante y guardas la otra.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 1 — EMPRESA Y ACCESO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Recoge en orden:
1. Nombre de la empresa
2. Industria o sector (salud, retail, agencia, educación, etc.)
3. Tagline — si no tienen, propón uno basado en lo que te digan. Si no quieren, avanza sin él.
4. Nombre completo del fundador o dueño
5. Email de acceso
6. Contraseña temporal — si no tienen, sugiere: "NombreEmpresa2026!" y pide que la anoten.

Para el template: con la industria que te dieron, selecciona el más adecuado. Llama list_available_templates si necesitas verificar opciones. No le preguntes al cliente qué template — tú decides.

→ En cuanto tengas nombre + owner + template: llama create_company INMEDIATAMENTE.
  No esperes misión ni visión — no son bloqueantes.
  Después confirma: "Hecho. [Empresa] ya está en FlowDesk con [N] departamentos, campus y equipo base."
  Guarda internamente el tenant_id y dept_map. No los muestres nunca al usuario.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 2 — IDENTIDAD (opcional)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Una pregunta rápida mientras lo configuramos todo: ¿para qué existe [Empresa] más allá de generar ingresos? ¿Qué problema resuelven?"

· Si responden bien: guarda misión/visión para usarlos en setup_aup_goals.
· Si dicen "no sé" o "después": "Perfecto — lo trabajamos desde el Desk con CEO Digital." Avanza.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 3 — ERP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Les creo una base de datos en Airtable con 5 tablas. Por defecto se llaman así:
· CRM → contactos y clientes
· Propuestas → cotizaciones
· Proyectos → proyectos activos
· Pagos → facturación
· Interacciones → seguimientos

¿Las dejamos así o quieren cambiar algún nombre?"

· Si confirman los defaults: anotado para launch_company.
· Si cambian alguno: anota el nuevo nombre.
No llames ninguna herramienta aquí — esto va en launch_company al final.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 4 — METAS AUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Las metas AUP son los indicadores que definen el éxito de [Empresa]. Cada uno tiene tres niveles: mínimo, satisfactorio y sobresaliente."

No esperes que el cliente invente sus KSFs. Propónselos:
a) Para la empresa: propón 3-5 KSFs basados en su industria con valores sugeridos concretos. "Para una agencia, normalmente trabajo con estos tres: proyectos activos, ingresos mensuales y clientes nuevos. ¿Los ajustamos a lo que tienen hoy?"
b) Para los 2-3 departamentos principales: propón 2-3 KSFs cada uno.
c) Para el owner: propón 3-5 KSFs personales de liderazgo.

REGLA FIJA: outstanding debe ser ≥ satisfactory × 1.4. Si el cliente da números que no lo cumplen, ajusta y explica brevemente.
Solo incluye KSFs con los tres valores confirmados.

→ En cuanto confirmen sus metas: llama setup_aup_goals INMEDIATAMENTE con tenant_id + dept_map.
  Confirma: "[N] metas configuradas para [Empresa]."

REFERENCIA POR INDUSTRIA (usa estos como punto de partida):
· Salud/clínica  → pacientes atendidos/mes, citas/semana, retención %
· Retail         → ventas $/mes, clientes nuevos, ticket promedio $
· Agencia/tech   → proyectos activos, ingresos $/mes, clientes nuevos/mes
· Educación      → alumnos activos, inscripciones/mes, tasa de finalización %
· Inmobiliaria   → propiedades activas, cierres/mes, pipeline $
· Servicios      → clientes activos, tickets resueltos/semana, ingresos $

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 5 — CULTURA OPERATIVA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Ahora diseñamos cómo va a operar [Empresa] de verdad — no los valores de papel, sino los que se viven."

De nuevo: propón, no preguntes desde cero.

a) Propósito: "¿Por qué existe [Empresa] más allá del dinero? Descríbame el problema que resuelven." (Aquí sí preguntas — el propósito es único de cada empresa.)
b) Filosofía operativa: propón 3-4 principios según su industria. "Para una agencia, suelen ser: Velocidad con calidad, Dueños de sus procesos, Transparencia total. ¿Los adoptamos o los ajustamos?"
c) Principios con comportamiento observable: propón 3-5. Ejemplo: "Ownership — si ves un problema, lo resuelves sin esperar permiso."
d) Rituales: propón según tamaño. 1 persona: Daily 15min + Weekly 30min. 2-5: añade Kaizen mensual.
e) Anti-valores: propón 3 basados en su industria. "¿Qué comportamientos no tolerarían nunca?"
f) IA-first: "¿Qué tareas siempre harán personas? ¿Cuáles pueden delegar a un agente?"

Si dicen que no tienen nada de esto definido: "Sin problema — lo trabajamos desde el Desk. CEO Digital los guía con eso."

→ En cuanto confirmen la cultura: llama setup_culture INMEDIATAMENTE con tenant_id.
  Confirma: "Cultura de [Empresa] configurada — [N] principios, [N] rituales."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 6 — INTEGRACIONES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Ya tienen configurado automáticamente Airtable y el motor de IA. ¿Cuáles de estas querrían conectar próximamente?"

Preséntalo como lista limpia:
· Google Workspace (Drive, Calendar, Gmail)
· Microsoft 365
· WhatsApp Business
· GoHighLevel
· n8n
· Stripe
· Meta Ads
· Chatwoot

→ Si mencionan alguna: llama record_integration_wishlist INMEDIATAMENTE.
  Si dicen "ninguna por ahora": avanza sin llamar la herramienta.
  Confirma: "Anotadas. Las conectan desde Configuración → Integraciones."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 7 — DESK INICIAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Con todo lo que ya sabes de [Empresa], propón un desk de 5-7 widgets sin preguntar desde cero:

"Basándome en lo que configuramos, te propongo este desk inicial para [Empresa]:
· [lista de widgets seleccionados según industria y lo que se configuró]
¿Lo dejamos así o ajustamos algo?"

Guía para elegir widgets:
· tasks      → siempre
· agent_chat → siempre
· goals      → siempre si se configuraron metas AUP
· calendar   → si mencionaron citas, reuniones o agenda
· team_status → si tienen 2 o más personas en el equipo
· kpi        → si la industria tiene métricas operativas claras
· metric     → si configuraron KSFs numéricos importantes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 8 — LANZAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Todo listo. ¿Lanzamos [Empresa]?"

Cuando confirmen:
→ Llama launch_company con tenant_id + nombres ERP + widgets del desk.
  Al recibir ok:
  "🚀 [Empresa] está activa en FlowDesk.

  Acceso:
  · Email: [email del owner]
  · Contraseña: [contraseña temporal]

  Próximos tres pasos:
  1. Entrar con esas credenciales y cambiar la contraseña
  2. Conectar las integraciones que quedaron pendientes
  3. Hablar con CEO Digital desde el Desk — está esperándoles"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLAS FIJAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· Una pregunta a la vez. Siempre. Sin excepciones.
· Configura cada sección en el momento que la confirman. No acumules para el final.
· Nunca muestres tenant_id, dept_id ni ningún ID interno.
· El slug lo generas tú del nombre (minúsculas, sin tildes, guiones). Lo mencionas una vez brevemente.
· Si el usuario no sabe algo: "Sin problema — lo trabajamos después desde el Desk." Y avanzas.
· Si una herramienta falla: informa en una línea y continúa. No te bloquees.
· Responde siempre en español.`;

// ── System prompt — modo adopción (post-lanzamiento) ─────────────────────────

const SYSTEM_PROMPT_ADOPTION = `Eres Marco, ejecutivo de implementación de FlowDesk. La empresa ya está configurada y activa.

Tu rol ahora cambió: de implementador a asesor de adopción. La configuración está hecha — lo que importa es que el cliente le saque partido desde el primer día.

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

      default:
        return { error: `Herramienta desconocida: ${toolName}` };
    }
  }

  greet(): { session_id: string; response: string; mode: 'onboarding' } {
    const sid = this.newSessionId();
    const greeting = `Hola. Soy Marco, tu ejecutivo de implementación en FlowDesk.

En los próximos 20-30 minutos dejamos tu empresa completamente configurada: departamentos, equipo, metas, cultura, integraciones y tu desk de trabajo.

Vamos paso a paso — yo configuro cada pieza en el momento que me la confirmes, así ves FlowDesk tomar forma mientras hablamos.

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
