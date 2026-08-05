-- Add cubo column to MentoriaCliente (idempotent)
ALTER TABLE "MentoriaCliente" ADD COLUMN IF NOT EXISTS "cubo" JSONB;

-- Create MentoriaDiagnostico table (idempotent)
CREATE TABLE IF NOT EXISTS "MentoriaDiagnostico" (
    "id"         TEXT        NOT NULL,
    "cliente_id" TEXT        NOT NULL,
    "area"       TEXT        NOT NULL,
    "datos"      JSONB       NOT NULL,
    "procesado"  BOOLEAN     NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentoriaDiagnostico_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MentoriaDiagnostico_cliente_id_idx" ON "MentoriaDiagnostico"("cliente_id");
CREATE INDEX IF NOT EXISTS "MentoriaDiagnostico_area_idx" ON "MentoriaDiagnostico"("area");

-- Add FK (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MentoriaDiagnostico_cliente_id_fkey'
  ) THEN
    ALTER TABLE "MentoriaDiagnostico"
      ADD CONSTRAINT "MentoriaDiagnostico_cliente_id_fkey"
      FOREIGN KEY ("cliente_id") REFERENCES "MentoriaCliente"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
