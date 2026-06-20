-- CreateTable
CREATE TABLE "WidgetConfig" (
    "id" TEXT NOT NULL,
    "proyecto_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nombre_agente" TEXT NOT NULL DEFAULT 'Asistente',
    "saludo" TEXT NOT NULL,
    "objetivo" TEXT NOT NULL,
    "preguntas" JSONB NOT NULL,
    "cierre_instruccion" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "mensaje_wa_template" TEXT,
    "color_primario" TEXT NOT NULL DEFAULT '#6366f1',
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidgetLead" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proyecto_id" TEXT NOT NULL,
    "nombre" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "respuestas" JSONB,
    "diagnostico" TEXT,
    "wa_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WidgetLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WidgetConfig_proyecto_id_key" ON "WidgetConfig"("proyecto_id");

-- CreateIndex
CREATE INDEX "WidgetConfig_tenant_id_idx" ON "WidgetConfig"("tenant_id");

-- CreateIndex
CREATE INDEX "WidgetLead_tenant_id_idx" ON "WidgetLead"("tenant_id");

-- CreateIndex
CREATE INDEX "WidgetLead_proyecto_id_idx" ON "WidgetLead"("proyecto_id");

-- CreateIndex
CREATE INDEX "WidgetLead_session_id_idx" ON "WidgetLead"("session_id");

-- AddForeignKey
ALTER TABLE "WidgetConfig" ADD CONSTRAINT "WidgetConfig_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "WebProyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetLead" ADD CONSTRAINT "WidgetLead_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "WebProyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
