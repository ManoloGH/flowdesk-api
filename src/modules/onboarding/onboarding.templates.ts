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

  // Mapa 1920×1080 — áreas distribuidas en el campus completo
  rooms: [
    // ── Sala de Juntas / War Room (arriba-izquierda) ───────────────────────
    {
      name: 'Sala de Juntas',
      room_type: 'meeting',
      x: 40,   y: 40,
      width: 480, height: 200,
      color: '#7F1D1D',   // rojo oscuro — zona de estrategia
    },

    // ── Dirección (centro-arriba) ──────────────────────────────────────────
    {
      name: 'Dirección',
      room_type: 'department',
      x: 560,  y: 40,
      width: 580, height: 200,
      color: '#4C1D95',   // indigo oscuro
    },

    // ── Red de Clientes (arriba-derecha) — solo visible para PLATFORM/NETWORK
    {
      name: 'Red de Clientes',
      room_type: 'network',
      x: 1180, y: 40,
      width: 680, height: 200,
      color: '#0C1445',   // azul muy oscuro — hub de control
    },

    // ── RH & AD (izquierda-medio) ─────────────────────────────────────────
    {
      name: 'RH & AD',
      room_type: 'department',
      x: 40,   y: 280,
      width: 500, height: 320,
      color: '#1E3A5F',   // azul oscuro
    },

    // ── Ventas (derecha-medio) ────────────────────────────────────────────
    {
      name: 'Ventas',
      room_type: 'department',
      x: 580,  y: 280,
      width: 960, height: 320,
      color: '#064E3B',   // verde oscuro
    },

    // ── Operaciones (abajo-izquierda) ─────────────────────────────────────
    {
      name: 'Operaciones',
      room_type: 'department',
      x: 40,   y: 640,
      width: 860, height: 280,
      color: '#451A03',   // ámbar oscuro
    },

    // ── Hub Técnico — sub-áreas (abajo-derecha) ───────────────────────────
    {
      name: 'Configuración',
      room_type: 'desk',
      x: 940,  y: 640,
      width: 300, height: 120,
      color: '#1E293B',   // slate
    },
    {
      name: 'Agentes',
      room_type: 'desk',
      x: 940,  y: 780,
      width: 300, height: 120,
      color: '#2E1065',   // violet oscuro
    },
    {
      name: 'Automatizaciones',
      room_type: 'desk',
      x: 1280, y: 640,
      width: 580, height: 260,
      color: '#0C4A6E',   // cyan oscuro
    },
  ],
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
};
