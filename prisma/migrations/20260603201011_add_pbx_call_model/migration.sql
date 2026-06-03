-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('INCOMING', 'ANSWERED_BY_AI', 'TRANSFERRED', 'COMPLETED', 'MISSED', 'VOICEMAIL');

-- AlterTable
ALTER TABLE "TeamSlot" ADD COLUMN     "pbx_extension" TEXT,
ADD COLUMN     "pbx_sip_password" TEXT;

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "from_number" TEXT NOT NULL,
    "to_extension" TEXT,
    "handled_by_id" TEXT,
    "status" "CallStatus" NOT NULL DEFAULT 'INCOMING',
    "duration_sec" INTEGER,
    "ai_transcript" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calls_tenant_id_idx" ON "calls"("tenant_id");

-- CreateIndex
CREATE INDEX "calls_tenant_id_status_idx" ON "calls"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
