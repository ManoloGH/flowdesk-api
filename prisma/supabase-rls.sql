-- =============================================================================
-- FlowDesk — Row Level Security (RLS) para Supabase
-- =============================================================================
-- INSTRUCCIONES:
--   Ejecutar en Supabase → SQL Editor
--   PRECAUCIÓN: habilitar RLS sin políticas bloquea TODAS las queries.
--   Aplica estas políticas ANTES de habilitar RLS en producción.
--
-- ARQUITECTURA:
--   La API usa Prisma con el DATABASE_URL del service role de Supabase.
--   El service role bypasea RLS por defecto. Para activar la protección
--   a nivel DB, el rol de la conexión debe ser NO superuser.
--
--   Opción A (recomendada): crear un rol de DB para la API con RLS activo.
--   Opción B (más simple): usar estas políticas como segunda capa de defensa,
--   configurando la conexión con BYPASSRLS=false.
--
-- PATRÓN: La API inyecta el tenant_id en el session con:
--   SET LOCAL app.current_tenant_id = '<tenant_id>';
--   (dentro de cada $transaction de Prisma)
-- =============================================================================

-- ─── Crear función helper para leer el tenant actual de la sesión ─────────────
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS text AS $$
  SELECT current_setting('app.current_tenant_id', true)
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- TABLAS CON tenant_id — habilitar RLS + políticas
-- =============================================================================

-- TeamSlots
ALTER TABLE "TeamSlot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_teamslot" ON "TeamSlot"
  USING (tenant_id = current_tenant_id());

-- Departments
ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_department" ON "Department"
  USING (tenant_id = current_tenant_id());

-- Tasks
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_task" ON "Task"
  USING (tenant_id = current_tenant_id());

-- Goals
ALTER TABLE "Goal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_goal" ON "Goal"
  USING (tenant_id = current_tenant_id());

-- Contacts
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_contact" ON "Contact"
  USING (tenant_id = current_tenant_id());

-- Integrations
ALTER TABLE "Integration" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_integration" ON "Integration"
  USING (tenant_id = current_tenant_id());

-- AgentConversations
ALTER TABLE "AgentConversation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_agentconversation" ON "AgentConversation"
  USING (tenant_id = current_tenant_id());

-- AgentMemory
ALTER TABLE "AgentMemory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_agentmemory" ON "AgentMemory"
  USING (tenant_id = current_tenant_id());

-- Meetings (transcripts — datos más sensibles)
ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_meeting" ON "meetings"
  USING (tenant_id = current_tenant_id());

-- AuditLogs (solo lectura por el propio tenant)
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_auditlog" ON "AuditLog"
  USING (tenant_id = current_tenant_id());

-- Messages
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_message" ON "Message"
  USING (tenant_id = current_tenant_id());

-- =============================================================================
-- TABLA Tenants — política especial: solo el propio tenant puede verse
-- =============================================================================
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_can_see_self" ON "Tenant"
  USING (id = current_tenant_id());

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================
-- Ejecutar para confirmar que las políticas están activas:
SELECT schemaname, tablename, policyname, permissive, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
