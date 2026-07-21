-- CreateTable: AgentSkill
CREATE TABLE "AgentSkill" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger_condition" TEXT NOT NULL,
    "response_instructions" TEXT NOT NULL,
    "example_conversation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AgentCorrection
CREATE TABLE "AgentCorrection" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'real',
    "verdict" TEXT NOT NULL DEFAULT 'error',
    "original_text" TEXT,
    "corrected_text" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AvailableModel
CREATE TABLE "AvailableModel" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'economy',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deprecated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailableModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentSkill_tenant_id_agent_id_idx" ON "AgentSkill"("tenant_id", "agent_id");

-- CreateIndex
CREATE INDEX "AgentCorrection_tenant_id_agent_id_idx" ON "AgentCorrection"("tenant_id", "agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "AvailableModel_model_id_key" ON "AvailableModel"("model_id");

-- CreateIndex
CREATE INDEX "AvailableModel_active_idx" ON "AvailableModel"("active");

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
