-- CreateTable
CREATE TABLE "WebProyecto" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nombre_cliente" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "dominio" TEXT,
    "sector" TEXT,
    "fase" TEXT NOT NULL DEFAULT 'setup',
    "vercel_url" TEXT,
    "vercel_project_id" TEXT,
    "assets" JSONB,
    "notas" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebProyecto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebProyecto_tenant_id_idx" ON "WebProyecto"("tenant_id");

-- CreateIndex
CREATE INDEX "WebProyecto_tenant_id_fase_idx" ON "WebProyecto"("tenant_id", "fase");

-- CreateIndex
CREATE UNIQUE INDEX "WebProyecto_tenant_id_slug_key" ON "WebProyecto"("tenant_id", "slug");

-- AddForeignKey
ALTER TABLE "WebProyecto" ADD CONSTRAINT "WebProyecto_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
