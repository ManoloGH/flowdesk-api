// ─── Diseño inicial del desk por defecto ────────────────────────────────────
// Layout de widgets para el dashboard del owner al crear una empresa.
// Se guarda como DashboardConfig al completar el onboarding.

export const DEFAULT_OWNER_DESK: { name: string; layout: any; widgets: any[] } = {
  name: 'Escritorio Principal',
  layout: { cols: 12, rowHeight: 80 },
  widgets: [
    {
      widget_type: 'tasks',
      title: 'Mis Tareas del Día',
      position: { x: 0, y: 0, w: 4, h: 4 },
      config: { filter: 'assigned_to_me', show_completed: false, max_items: 10 },
    },
    {
      widget_type: 'team_status',
      title: 'Estado del Equipo',
      position: { x: 4, y: 0, w: 4, h: 4 },
      config: { show_agents: true, show_offline: false },
    },
    {
      widget_type: 'metric',
      title: 'Resumen de Empresa',
      position: { x: 8, y: 0, w: 4, h: 4 },
      config: { metrics: ['tasks_pending', 'agents_online', 'contacts_total'] },
    },
    {
      widget_type: 'calendar',
      title: 'Próximos Eventos',
      position: { x: 0, y: 4, w: 6, h: 4 },
      config: { days_ahead: 7 },
    },
    {
      widget_type: 'agent_chat',
      title: 'Atlas — CEO Agent',
      position: { x: 6, y: 4, w: 6, h: 4 },
      config: {
        agent_role: 'ceo',
        quick_prompts: ['¿Qué debo hacer hoy?', '¿Cómo van los KPIs?', 'Dame un resumen de la semana'],
      },
    },
    {
      widget_type: 'goals',
      title: 'Metas AUP',
      position: { x: 0, y: 8, w: 12, h: 3 },
      config: { view: 'ksf_status', period: 'current' },
    },
  ],
};

// ─── Desk especializado para el owner de MentorIA (plataforma) ───────────────
// Incluye KPIs propios de MentorIA: clientes activos, productos en operación.

export const MENTORIA_OWNER_DESK: { name: string; layout: any; widgets: any[] } = {
  name: 'Escritorio MentorIA',
  layout: { cols: 12, rowHeight: 80 },
  widgets: [
    {
      widget_type: 'kpi',
      title: 'KPIs MentorIA',
      position: { x: 0, y: 0, w: 4, h: 4 },
      config: {
        metrics: [
          { key: 'clientes_tipo_b', label: 'Clientes Tipo B', target: 50, unit: 'clientes' },
          { key: 'clientes_tipo_a', label: 'Clientes Tipo A', target: 5, unit: 'clientes' },
          { key: 'productos_saas', label: 'Productos SaaS', target: 5, unit: 'productos' },
          { key: 'setup_time_hours', label: 'Setup por cliente', target: 8, unit: 'horas', invert: true },
        ],
      },
    },
    {
      widget_type: 'team_status',
      title: 'Equipo + Agentes',
      position: { x: 4, y: 0, w: 4, h: 4 },
      config: { show_agents: true, show_offline: false, group_by: 'type' },
    },
    {
      widget_type: 'tasks',
      title: 'Mis Tareas del Día',
      position: { x: 8, y: 0, w: 4, h: 4 },
      config: { filter: 'assigned_to_me', show_completed: false, max_items: 8 },
    },
    {
      widget_type: 'agent_chat',
      title: 'Atlas — CEO Agent',
      position: { x: 0, y: 4, w: 6, h: 5 },
      config: {
        agent_role: 'ceo',
        quick_prompts: [
          '¿Qué debo hacer hoy?',
          '¿Cómo van los KPIs del mes?',
          '¿Qué oportunidades hay esta semana?',
          'Dame un resumen del estado de los clientes',
          '¿Qué agentes necesitan atención?',
        ],
      },
    },
    {
      widget_type: 'calendar',
      title: 'Agenda de la Semana',
      position: { x: 6, y: 4, w: 6, h: 5 },
      config: { days_ahead: 7, show_all_day: true },
    },
    {
      widget_type: 'goals',
      title: 'Metas AUP — MentorIA',
      position: { x: 0, y: 9, w: 12, h: 3 },
      config: { view: 'ksf_status', period: 'current', show_trend: true },
    },
  ],
};

// ─── Arquitectura universal del campus ───────────────────────────────────────
// Todas las empresas arrancan con estas mismas áreas y mapa.
// Lo que varía por industria: horario y agentes sugeridos.

export const UNIVERSAL_CAMPUS = {
  departments: [
    { name: 'Dirección',      color: '#7C3AED', icon: '🧠' },
    { name: 'Ventas',         color: '#10B981', icon: '💰' },
    { name: 'Operaciones',    color: '#F59E0B', icon: '⚙️' },
    { name: 'RH & AD',        color: '#3B82F6', icon: '👥' },
    { name: 'Hub Técnico',    color: '#6366F1', icon: '🤖' },
  ],

  // Las salas se generan dinámicamente en onboarding.service.ts::buildRoomsFromDepartments()
  // a partir de los departamentos reales que declare la empresa.
  rooms: [],
};

// ─── Templates predefinidos por industria ────────────────────────────────────
// Solo determinan: horario laboral y agentes IA sugeridos.
// Departments y rooms siempre vienen de UNIVERSAL_CAMPUS.

export const INDUSTRY_TEMPLATES: Record<string, any> = {
  solo: {
    display_name: 'Emprendedor / Autoempleado',
    departments: [
      { name: 'Operaciones', color: '#6366F1', icon: '⚙️' },
      { name: 'Ventas', color: '#10B981', icon: '💰' },
      { name: 'Administración', color: '#F59E0B', icon: '📋' },
    ],
    schedule: {
      name: 'Horario Flexible',
      check_in_time: '09:00',
      check_out_time: '18:00',
      tolerance_minutes: 30,
      work_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    },
    rooms: [
      { name: 'Mi Escritorio', room_type: 'desk', x: 100, y: 100, width: 200, height: 150, color: '#E0E7FF' },
      { name: 'Sala de Reuniones', room_type: 'meeting', x: 350, y: 100, width: 200, height: 150, color: '#D1FAE5' },
    ],
    suggested_agents: [
      { name: 'Asistente Personal', instructions: 'Eres mi asistente personal. Ayúdame a organizar mi agenda, recordatorios y tareas del día.' },
      { name: 'Asistente de Ventas', instructions: 'Ayúdame a gestionar prospectos, hacer seguimiento a clientes y recordarme oportunidades de venta.' },
    ],
  },

  real_estate: {
    display_name: 'Inmobiliaria',
    departments: [
      { name: 'Ventas', color: '#10B981', icon: '🏠' },
      { name: 'Administración', color: '#6366F1', icon: '📋' },
      { name: 'Marketing', color: '#F59E0B', icon: '📣' },
      { name: 'Soporte al Cliente', color: '#EC4899', icon: '🎧' },
    ],
    schedule: {
      name: 'Horario Inmobiliaria',
      check_in_time: '09:00',
      check_out_time: '18:00',
      tolerance_minutes: 15,
      work_days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    },
    rooms: [
      { name: 'Recepción', room_type: 'desk', x: 50, y: 50, width: 150, height: 100, color: '#FEF3C7' },
      { name: 'Ventas', room_type: 'department', x: 250, y: 50, width: 250, height: 200, color: '#D1FAE5' },
      { name: 'Administración', room_type: 'department', x: 550, y: 50, width: 200, height: 200, color: '#E0E7FF' },
      { name: 'Sala de Juntas', room_type: 'meeting', x: 50, y: 200, width: 150, height: 150, color: '#FCE7F3' },
    ],
    suggested_agents: [
      { name: 'Coordinador de Citas', instructions: 'Agenda y gestiona visitas a propiedades. Confirma citas, envía recordatorios y registra el seguimiento.' },
      { name: 'Asistente de WhatsApp', instructions: 'Responde consultas de clientes sobre propiedades disponibles, precios y horarios de visita.' },
    ],
  },

  construction: {
    display_name: 'Constructora',
    departments: [
      { name: 'Gerencia', color: '#7C3AED', icon: '👔' },
      { name: 'Proyectos', color: '#2563EB', icon: '🏗️' },
      { name: 'Compras', color: '#D97706', icon: '🛒' },
      { name: 'Recursos Humanos', color: '#059669', icon: '👥' },
      { name: 'Administración', color: '#6366F1', icon: '📋' },
      { name: 'Campo / Obra', color: '#DC2626', icon: '🦺' },
    ],
    schedule: {
      name: 'Horario Constructora',
      check_in_time: '07:00',
      check_out_time: '17:00',
      tolerance_minutes: 10,
      work_days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    },
    rooms: [
      { name: 'Gerencia', room_type: 'desk', x: 50, y: 50, width: 150, height: 100, color: '#EDE9FE' },
      { name: 'Proyectos', room_type: 'department', x: 250, y: 50, width: 300, height: 200, color: '#DBEAFE' },
      { name: 'Compras', room_type: 'department', x: 600, y: 50, width: 200, height: 150, color: '#FEF3C7' },
      { name: 'RRHH', room_type: 'department', x: 50, y: 200, width: 150, height: 150, color: '#D1FAE5' },
      { name: 'Sala de Juntas', room_type: 'meeting', x: 600, y: 250, width: 200, height: 150, color: '#FCE7F3' },
    ],
    suggested_agents: [
      { name: 'Coordinador de Obra', instructions: 'Ayuda a registrar avances de obra, incidencias y reportes diarios de campo.' },
      { name: 'Asistente de Compras', instructions: 'Gestiona solicitudes de materiales, seguimiento a proveedores y control de inventario básico.' },
    ],
  },

  startup: {
    display_name: 'Startup / SaaS',
    departments: [
      { name: 'Producto', color: '#7C3AED', icon: '🚀' },
      { name: 'Ingeniería', color: '#2563EB', icon: '💻' },
      { name: 'Ventas', color: '#10B981', icon: '💰' },
      { name: 'Marketing', color: '#F59E0B', icon: '📣' },
      { name: 'Éxito del Cliente', color: '#EC4899', icon: '🎧' },
      { name: 'Operaciones', color: '#6366F1', icon: '⚙️' },
    ],
    schedule: {
      name: 'Horario Flexible Startup',
      check_in_time: '09:00',
      check_out_time: '18:00',
      tolerance_minutes: 30,
      work_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    },
    rooms: [
      { name: 'Open Space', room_type: 'department', x: 50, y: 50, width: 400, height: 250, color: '#EDE9FE' },
      { name: 'Sala de Producto', room_type: 'meeting', x: 500, y: 50, width: 200, height: 120, color: '#DBEAFE' },
      { name: 'Sala de Ventas', room_type: 'department', x: 500, y: 200, width: 200, height: 100, color: '#D1FAE5' },
      { name: 'Sala de Demos', room_type: 'meeting', x: 50, y: 350, width: 200, height: 120, color: '#FCE7F3' },
      { name: 'Zona de Descanso', room_type: 'break', x: 300, y: 350, width: 400, height: 120, color: '#FEF9C3' },
    ],
    suggested_agents: [
      { name: 'Asistente de Producto', instructions: 'Ayuda al equipo de producto a gestionar el backlog, registrar feedback de usuarios y priorizar features.' },
      { name: 'Asistente de Ventas', instructions: 'Califica leads, hace seguimiento al pipeline de ventas y coordina demos con prospectos.' },
      { name: 'Soporte al Cliente', instructions: 'Atiende dudas de clientes, escala bugs al equipo técnico y gestiona solicitudes de soporte.' },
    ],
  },

  corporate: {
    display_name: 'Corporativo',
    departments: [
      { name: 'Dirección General', color: '#7C3AED', icon: '🏢' },
      { name: 'Recursos Humanos', color: '#059669', icon: '👥' },
      { name: 'Finanzas', color: '#D97706', icon: '💼' },
      { name: 'Tecnología', color: '#2563EB', icon: '💻' },
      { name: 'Marketing', color: '#F59E0B', icon: '📣' },
      { name: 'Ventas', color: '#10B981', icon: '💰' },
      { name: 'Operaciones', color: '#6366F1', icon: '⚙️' },
      { name: 'Legal', color: '#DC2626', icon: '⚖️' },
    ],
    schedule: {
      name: 'Horario Corporativo',
      check_in_time: '09:00',
      check_out_time: '18:00',
      tolerance_minutes: 15,
      work_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    },
    rooms: [
      { name: 'Lobby / Recepción', room_type: 'desk', x: 50, y: 50, width: 200, height: 100, color: '#FEF3C7' },
      { name: 'Dirección', room_type: 'department', x: 50, y: 200, width: 150, height: 150, color: '#EDE9FE' },
      { name: 'RRHH', room_type: 'department', x: 250, y: 50, width: 200, height: 150, color: '#D1FAE5' },
      { name: 'Finanzas', room_type: 'department', x: 250, y: 250, width: 200, height: 150, color: '#FEF3C7' },
      { name: 'Tecnología', room_type: 'department', x: 500, y: 50, width: 200, height: 150, color: '#DBEAFE' },
      { name: 'Marketing & Ventas', room_type: 'department', x: 500, y: 250, width: 200, height: 150, color: '#D1FAE5' },
      { name: 'Sala de Juntas A', room_type: 'meeting', x: 750, y: 50, width: 150, height: 150, color: '#FCE7F3' },
      { name: 'Sala de Juntas B', room_type: 'meeting', x: 750, y: 250, width: 150, height: 150, color: '#FCE7F3' },
      { name: 'Cafetería', room_type: 'break', x: 50, y: 400, width: 850, height: 100, color: '#FEF9C3' },
    ],
    suggested_agents: [
      { name: 'Asistente Ejecutivo', instructions: 'Gestiona agenda de dirección, coordina reuniones y filtra comunicaciones importantes.' },
      { name: 'Helpdesk TI', instructions: 'Atiende tickets de soporte técnico, registra incidencias y escala problemas críticos.' },
      { name: 'Asistente de RRHH', instructions: 'Responde preguntas sobre políticas, vacaciones, nómina y onboarding de nuevos colaboradores.' },
    ],
  },

  // ─── MentorIA Systems — template de plataforma IA ─────────────────────────
  // Primer template real. Representa el ADN operativo de MentorIA.
  // Sirve como metodología de referencia para onboarding de futuros tenants.
  mentoria: {
    display_name: 'MentorIA Systems — Plataforma IA',

    // Identidad de empresa (ADN) — se guarda en el Tenant al crear
    adn: {
      tagline: 'inteligencia humana, potencia artificial',
      industry: 'Tecnología — Agentes de Inteligencia Artificial',
      primary_color: '#4DBBF0',
      secondary_color: '#1A7FDB',
      mission:
        'Dar a los negocios latinoamericanos acceso a departamentos completos de inteligencia artificial que trabajen junto a sus equipos humanos — reduciendo la dependencia de personal costoso, eliminando tareas repetitivas y liberando tiempo para lo que realmente mueve el negocio.',
      vision:
        'Ser la infraestructura de agentes de IA más usada por las PYMEs de Latinoamérica: el lugar desde donde cualquier negocio —de una sola persona o de cien— orquesta a sus agentes, sus datos y su equipo humano desde un solo ecosistema.',
    },

    // Departamentos — refleja la estructura operativa real de MentorIA
    departments: [
      { name: 'Dirección',          color: '#7C3AED', icon: '🧠', dept_type: 'management' },
      { name: 'Hub Técnico',        color: '#6366F1', icon: '🤖', dept_type: 'ops' },
      { name: 'Marketing Digital',  color: '#F59E0B', icon: '📣', dept_type: 'marketing' },
      { name: 'Ventas',             color: '#10B981', icon: '💰', dept_type: 'sales' },
      { name: 'Operaciones',        color: '#D97706', icon: '⚙️', dept_type: 'ops' },
      { name: 'Delivery',           color: '#3B82F6', icon: '🚀', dept_type: 'delivery' },
    ],

    // Horario — flexible, startup style con margen amplio
    schedule: {
      name: 'Horario Flexible MentorIA',
      check_in_time: '09:00',
      check_out_time: '20:00',
      tolerance_minutes: 30,
      work_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    },

    // Mapa del campus — generado dinámicamente desde departamentos en setupRooms()
    rooms: [],

    // Equipo humano inicial — basado en ADN §8
    initial_team: [
      {
        name: 'Founder / Técnico',
        role: 'owner',
        department_name: 'Dirección',
        // email y password se capturan en el formulario de onboarding
      },
      {
        name: 'Director Creativo',
        role: 'admin',
        department_name: 'Marketing Digital',
      },
      {
        name: 'Diseñador',
        role: 'employee',
        department_name: 'Marketing Digital',
      },
    ],

    // Agentes IA sugeridos — basados en las necesidades operativas del ADN
    suggested_agents: [
      {
        name: 'Agente de Marketing',
        model: 'claude-sonnet-4-6',
        agent_role: 'marketing',
        department_name: 'Marketing Digital',
        instructions:
          'Eres el Agente de Marketing de MentorIA Systems. Tu misión: gestionar el contenido semanal de las redes sociales de MentorIA y de los clientes del Agente de Marketing Digital. Cada lunes: ejecutas el research (Serper) y generas copies, ideas de imágenes y guiones de video IA. Registras todo en Airtable. Reportas al Director Creativo para aprobación antes de publicar. No publicas sin aprobación. Conoces el ciclo semanal: Lunes research→martes cliente graba→miércoles DC aprueba→jueves asesor notifica→viernes cliente aprueba y se publica.',
      },
      {
        name: 'Agente de Operaciones',
        model: 'claude-haiku-4-5-20251001',
        agent_role: 'operations',
        department_name: 'Operaciones',
        instructions:
          'Eres el Agente de Operaciones de MentorIA Systems. Monitoreas el estado de todos los sistemas: n8n, Evolution API, Airtable, Softr y FlowDesk. Si detectas una falla o un workflow detenido, alertas inmediatamente al Founder con el detalle del problema y el impacto en clientes. También gestionas el pipeline de onboarding de nuevos clientes: verificas que cada paso del setup esté completo y alertas si algún cliente lleva más de 2 días sin avanzar.',
      },
      {
        name: 'Agente de Ventas',
        model: 'claude-haiku-4-5-20251001',
        agent_role: 'sales',
        department_name: 'Ventas',
        instructions:
          'Eres el Agente de Ventas de MentorIA Systems. Tu objetivo: dar seguimiento al pipeline de prospectos para el Agente de Marketing Digital (Tipo B) y para ecosistemas dedicados (Tipo A). Registras cada interacción en el CRM de FlowDesk. Cuando un prospecto muestra interés, preparas la propuesta inicial con el precio y los servicios correspondientes al tipo de cliente. Nunca cierras un trato sin confirmación del Founder.',
      },
      {
        name: 'Agente de Delivery',
        model: 'claude-haiku-4-5-20251001',
        agent_role: 'delivery',
        department_name: 'Delivery',
        instructions:
          'Eres el Agente de Delivery de MentorIA Systems. Coordinas la entrega de servicios a clientes activos. Para clientes Tipo B: verificas que el ciclo semanal de contenido esté en marcha y que el cliente haya recibido sus entregables. Para clientes Tipo A: haces seguimiento al avance del ecosistema dedicado y reportas al Founder si hay riesgo de retraso. Mantienes actualizado el estado de cada cliente en FlowDesk.',
      },
    ],

    // Diseño inicial del desk del owner — layout específico para MentorIA
    initial_desk_layout: 'mentoria_owner', // referencia a MENTORIA_OWNER_DESK
  },
};
