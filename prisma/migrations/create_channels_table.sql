-- Add channels table for Central de Comunicaciones conmutador
CREATE TABLE IF NOT EXISTS "channels" (
  "id"                     TEXT         NOT NULL,
  "tenant_id"              TEXT         NOT NULL,
  "type"                   TEXT         NOT NULL,
  "external_id"            TEXT         NOT NULL,
  "name"                   TEXT         NOT NULL,
  "number"                 TEXT,
  "status"                 TEXT         NOT NULL DEFAULT 'unconfigured',
  "config_href"            TEXT,
  "routing_type"           TEXT,
  "routing_agent_id"       TEXT,
  "routing_user_id"        TEXT,
  "routing_forward_number" TEXT,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "channels_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "channels_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "channels_tenant_id_external_id_key"
  ON "channels"("tenant_id", "external_id");

CREATE INDEX IF NOT EXISTS "channels_tenant_id_idx"
  ON "channels"("tenant_id");
