-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('PLATFORM', 'NETWORK', 'BRANCH');

-- CreateEnum
CREATE TYPE "DeskAccess" AS ENUM ('FULL', 'LIGHT', 'NONE');

-- AlterTable
ALTER TABLE "TeamSlot" ADD COLUMN     "access_token" TEXT,
ADD COLUMN     "desk_access" "DeskAccess" NOT NULL DEFAULT 'FULL';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "airtable_project_id" TEXT,
ADD COLUMN     "billing_email" TEXT,
ADD COLUMN     "current_period_end" TIMESTAMP(3),
ADD COLUMN     "employee_desks_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "external_ref" TEXT,
ADD COLUMN     "network_id" TEXT,
ADD COLUMN     "stripe_customer_id" TEXT,
ADD COLUMN     "stripe_sub_status" TEXT,
ADD COLUMN     "stripe_subscription_id" TEXT,
ADD COLUMN     "tenant_type" "TenantType" NOT NULL DEFAULT 'BRANCH';

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT,
    "platform" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_secs" INTEGER,
    "transcript" JSONB NOT NULL,
    "speaker_map" JSONB,
    "summary" TEXT,
    "action_items" JSONB,
    "doc_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_tenant_id_idx" ON "meetings"("tenant_id");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_created_at_idx" ON "meetings"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSlot_access_token_key" ON "TeamSlot"("access_token");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
