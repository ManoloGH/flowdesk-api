-- CreateTable
CREATE TABLE "FounderProfile" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "industry_change" TEXT,
    "differentiator" TEXT,
    "loved_behaviors" JSONB,
    "zero_tolerance" JSONB,
    "hated_inefficiencies" JSONB,
    "doing_well_means" TEXT,
    "team_feeling" TEXT,
    "client_energy" TEXT,
    "ai_tasks" JSONB,
    "ai_never_replace" JSONB,
    "tone_description" TEXT,
    "leadership_style" TEXT,
    "operating_style" TEXT,
    "key_obsessions" JSONB,
    "decision_principles" JSONB,
    "atlas_instructions" TEXT,
    "atlas_calibrated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FounderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationProfile" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tone" TEXT,
    "energy" TEXT,
    "formality" TEXT,
    "structure" TEXT,
    "avg_length" TEXT,
    "key_phrases" JSONB,
    "avoid_phrases" JSONB,
    "custom_vocab" JSONB,
    "samples" JSONB,
    "extracted_patterns" JSONB,
    "voice_summary" TEXT,
    "samples_count" INTEGER NOT NULL DEFAULT 0,
    "calibration_quality" TEXT,
    "last_calibrated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CultureBlueprint" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "philosophy_statements" JSONB,
    "operational_rules" JSONB,
    "response_standards" JSONB,
    "decision_frameworks" JSONB,
    "company_language" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CultureBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingMap" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "current_systems" JSONB,
    "key_processes" JSONB,
    "pain_points" JSONB,
    "health_score" INTEGER,
    "health_breakdown" JSONB,
    "last_health_check" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FounderProfile_tenant_id_key" ON "FounderProfile"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationProfile_tenant_id_key" ON "CommunicationProfile"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "CultureBlueprint_tenant_id_key" ON "CultureBlueprint"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "OperatingMap_tenant_id_key" ON "OperatingMap"("tenant_id");

-- AddForeignKey
ALTER TABLE "FounderProfile" ADD CONSTRAINT "FounderProfile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationProfile" ADD CONSTRAINT "CommunicationProfile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CultureBlueprint" ADD CONSTRAINT "CultureBlueprint_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingMap" ADD CONSTRAINT "OperatingMap_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
