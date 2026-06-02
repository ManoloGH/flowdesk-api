-- CreateTable
CREATE TABLE "SecretaryConfig" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner_phone" TEXT NOT NULL,
    "evolution_instance" TEXT,
    "morning_brief_time" TEXT NOT NULL DEFAULT '08:00',
    "morning_brief_enabled" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecretaryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingApproval" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelegationHistory" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "from_slot" TEXT NOT NULL,
    "to_slot" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "result" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelegationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkReport" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecretaryConfig_tenant_id_key" ON "SecretaryConfig"("tenant_id");

-- CreateIndex
CREATE INDEX "PendingApproval_tenant_id_status_idx" ON "PendingApproval"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "DelegationHistory_tenant_id_idx" ON "DelegationHistory"("tenant_id");

-- CreateIndex
CREATE INDEX "WorkReport_tenant_id_slot_id_idx" ON "WorkReport"("tenant_id", "slot_id");

-- CreateIndex
CREATE INDEX "WorkReport_tenant_id_period_idx" ON "WorkReport"("tenant_id", "period");

-- AddForeignKey
ALTER TABLE "SecretaryConfig" ADD CONSTRAINT "SecretaryConfig_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingApproval" ADD CONSTRAINT "PendingApproval_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegationHistory" ADD CONSTRAINT "DelegationHistory_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
