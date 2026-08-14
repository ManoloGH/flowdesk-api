-- Add sesiones_diagnostico to MentoriaCliente (idempotent)
-- Stores named diagnostic sessions: [{id, titulo, tipo, interlocutor, cargo, area, fecha, mensajes, cuestionarios_generados}]
ALTER TABLE "MentoriaCliente" ADD COLUMN IF NOT EXISTS "sesiones_diagnostico" JSONB;
