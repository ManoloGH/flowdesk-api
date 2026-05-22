-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Reunión',
    "platform" TEXT NOT NULL DEFAULT 'otro',
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_secs" INTEGER,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "speaker_map" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "action_items" JSONB NOT NULL DEFAULT '[]',
    "doc_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_tenant_id_idx" ON "Meeting"("tenant_id");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
