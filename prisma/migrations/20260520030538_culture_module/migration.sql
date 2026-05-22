/*
  Warnings:

  - You are about to drop the `meetings` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "RitualType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SPECIAL');

-- DropForeignKey
ALTER TABLE "Tenant" DROP CONSTRAINT "Tenant_network_id_fkey";

-- DropForeignKey
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_tenant_id_fkey";

-- DropTable
DROP TABLE "meetings";

-- CreateTable
CREATE TABLE "CultureConfig" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purpose" TEXT,
    "problem_statement" TEXT,
    "desired_impact" TEXT,
    "operative_philosophy" JSONB,
    "anti_values" JSONB,
    "recognition_behaviors" JSONB,
    "recognition_awards" JSONB,
    "feedback_framework" JSONB,
    "internal_language" JSONB,
    "ai_human_division" JSONB,
    "ai_principles" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CultureConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CulturePrinciple" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "culture_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "observable_behavior" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CulturePrinciple_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CultureRitual" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "culture_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ritual_type" "RitualType" NOT NULL,
    "duration_minutes" INTEGER,
    "description" TEXT,
    "agenda" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CultureRitual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CultureConfig_tenant_id_key" ON "CultureConfig"("tenant_id");

-- AddForeignKey
ALTER TABLE "KeySuccessFactor" ADD CONSTRAINT "KeySuccessFactor_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CultureConfig" ADD CONSTRAINT "CultureConfig_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CulturePrinciple" ADD CONSTRAINT "CulturePrinciple_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CulturePrinciple" ADD CONSTRAINT "CulturePrinciple_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "CultureConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CultureRitual" ADD CONSTRAINT "CultureRitual_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CultureRitual" ADD CONSTRAINT "CultureRitual_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "CultureConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
