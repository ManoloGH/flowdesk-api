CREATE TABLE IF NOT EXISTS "micro_diagnosticos" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "lead_name" TEXT,
  "lead_company" TEXT,
  "lead_phone" TEXT NOT NULL,
  "responses" JSONB NOT NULL,
  "diagnostic_data" JSONB,
  "contact_id" TEXT,
  "deal_id" TEXT,
  "cal_booking_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "micro_diagnosticos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "micro_diagnosticos_token_key" ON "micro_diagnosticos"("token");
CREATE INDEX IF NOT EXISTS "micro_diagnosticos_tenant_id_idx" ON "micro_diagnosticos"("tenant_id");
CREATE INDEX IF NOT EXISTS "micro_diagnosticos_tenant_phone_idx" ON "micro_diagnosticos"("tenant_id", "lead_phone");
DO $$ BEGIN
  ALTER TABLE "micro_diagnosticos"
    ADD CONSTRAINT "micro_diagnosticos_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
