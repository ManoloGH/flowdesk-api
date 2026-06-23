-- CreateTable
CREATE TABLE "MentoriaProspecto" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "contacto" TEXT NOT NULL,
    "email" TEXT,
    "whatsapp" TEXT,
    "industria" TEXT,
    "tamano" TEXT,
    "etapa" TEXT NOT NULL DEFAULT 'agente_ia',
    "puntuacion" INTEGER,
    "ejecutivo_asignado" TEXT,
    "canal" TEXT,
    "conversacion" JSONB,
    "micro_diagnostico" TEXT,
    "hallazgos_preventa" JSONB,
    "roi_estimado" TEXT,
    "notas" TEXT,
    "fecha_ultima_accion" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentoriaProspecto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentoriaCliente" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "prospecto_id" TEXT,
    "empresa" TEXT NOT NULL,
    "contacto_nombre" TEXT NOT NULL,
    "contacto_cargo" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "industria" TEXT,
    "tamano" TEXT,
    "status" TEXT NOT NULL DEFAULT 'activo',
    "ejecutivo_asignado" TEXT,
    "drive_url" TEXT,
    "fase_actual" INTEGER NOT NULL DEFAULT 0,
    "areas_diagnosticadas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "precio" INTEGER NOT NULL DEFAULT 0,
    "notas" TEXT,
    "fecha_inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_fin" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentoriaCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentoriaHallazgo" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "impacto" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MentoriaHallazgo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentoriaAccionPlan" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "hallazgo_id" TEXT,
    "titulo" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "prioridad" TEXT NOT NULL DEFAULT 'alta',
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "responsable" TEXT,
    "fecha_estimada" TIMESTAMP(3),
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentoriaAccionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentoriaSesion" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "notas" TEXT,
    "acciones" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MentoriaSesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentoriaPago" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "monto" INTEGER NOT NULL,
    "concepto" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MentoriaPago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentoriaCheck" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "check_id" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checked_at" TIMESTAMP(3),

    CONSTRAINT "MentoriaCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentoriaDiagnostico" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "datos" JSONB NOT NULL,
    "procesado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentoriaDiagnostico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MentoriaProspecto_tenant_id_idx" ON "MentoriaProspecto"("tenant_id");

-- CreateIndex
CREATE INDEX "MentoriaProspecto_etapa_idx" ON "MentoriaProspecto"("etapa");

-- CreateIndex
CREATE UNIQUE INDEX "MentoriaCliente_prospecto_id_key" ON "MentoriaCliente"("prospecto_id");

-- CreateIndex
CREATE INDEX "MentoriaCliente_tenant_id_idx" ON "MentoriaCliente"("tenant_id");

-- CreateIndex
CREATE INDEX "MentoriaCliente_status_idx" ON "MentoriaCliente"("status");

-- CreateIndex
CREATE INDEX "MentoriaHallazgo_cliente_id_idx" ON "MentoriaHallazgo"("cliente_id");

-- CreateIndex
CREATE INDEX "MentoriaHallazgo_tipo_idx" ON "MentoriaHallazgo"("tipo");

-- CreateIndex
CREATE INDEX "MentoriaAccionPlan_cliente_id_idx" ON "MentoriaAccionPlan"("cliente_id");

-- CreateIndex
CREATE INDEX "MentoriaAccionPlan_status_idx" ON "MentoriaAccionPlan"("status");

-- CreateIndex
CREATE INDEX "MentoriaSesion_cliente_id_idx" ON "MentoriaSesion"("cliente_id");

-- CreateIndex
CREATE INDEX "MentoriaPago_cliente_id_idx" ON "MentoriaPago"("cliente_id");

-- CreateIndex
CREATE INDEX "MentoriaCheck_cliente_id_idx" ON "MentoriaCheck"("cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "MentoriaCheck_cliente_id_check_id_key" ON "MentoriaCheck"("cliente_id", "check_id");

-- CreateIndex
CREATE INDEX "MentoriaDiagnostico_cliente_id_idx" ON "MentoriaDiagnostico"("cliente_id");

-- CreateIndex
CREATE INDEX "MentoriaDiagnostico_area_idx" ON "MentoriaDiagnostico"("area");

-- AddForeignKey
ALTER TABLE "MentoriaProspecto" ADD CONSTRAINT "MentoriaProspecto_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaCliente" ADD CONSTRAINT "MentoriaCliente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaCliente" ADD CONSTRAINT "MentoriaCliente_prospecto_id_fkey" FOREIGN KEY ("prospecto_id") REFERENCES "MentoriaProspecto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaHallazgo" ADD CONSTRAINT "MentoriaHallazgo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "MentoriaCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaAccionPlan" ADD CONSTRAINT "MentoriaAccionPlan_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "MentoriaCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaAccionPlan" ADD CONSTRAINT "MentoriaAccionPlan_hallazgo_id_fkey" FOREIGN KEY ("hallazgo_id") REFERENCES "MentoriaHallazgo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaSesion" ADD CONSTRAINT "MentoriaSesion_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "MentoriaCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaPago" ADD CONSTRAINT "MentoriaPago_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "MentoriaCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaCheck" ADD CONSTRAINT "MentoriaCheck_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "MentoriaCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaDiagnostico" ADD CONSTRAINT "MentoriaDiagnostico_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "MentoriaCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
