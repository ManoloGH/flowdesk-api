-- AlterTable
ALTER TABLE "TeamSlot" ADD COLUMN     "derived_from_template_id" TEXT,
ADD COLUMN     "template_sync_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "migration_at" TIMESTAMP(3),
ADD COLUMN     "migration_status" TEXT,
ADD COLUMN     "self_hosted_url" TEXT;

-- CreateTable
CREATE TABLE "AgentLearningProposal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "proposal_type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "proposed_changes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "source_urls" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentLearningProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentLearningProposal_tenant_id_status_idx" ON "AgentLearningProposal"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "AgentLearningProposal_agent_id_idx" ON "AgentLearningProposal"("agent_id");

-- CreateIndex
CREATE INDEX "AgentLearningProposal_tenant_id_week_start_idx" ON "AgentLearningProposal"("tenant_id", "week_start");

-- AddForeignKey
ALTER TABLE "AgentLearningProposal" ADD CONSTRAINT "AgentLearningProposal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLearningProposal" ADD CONSTRAINT "AgentLearningProposal_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
