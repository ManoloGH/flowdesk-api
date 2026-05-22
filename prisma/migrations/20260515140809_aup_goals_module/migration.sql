-- CreateEnum
CREATE TYPE "KsfLevel" AS ENUM ('COMPANY', 'DEPARTMENT', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "KsfCategory" AS ENUM ('OPERATIONAL', 'COORDINATION', 'STRATEGIC');

-- CreateEnum
CREATE TYPE "KsfStatus" AS ENUM ('NO_DATA', 'BELOW_MINIMUM', 'AT_MINIMUM', 'IN_PROGRESS', 'SATISFACTORY', 'OUTSTANDING');

-- CreateEnum
CREATE TYPE "KsfOrigin" AS ENUM ('TOP_DOWN', 'BOTTOM_UP');

-- CreateEnum
CREATE TYPE "MeasurementFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "MeasurementSource" AS ENUM ('TASKS_COMPLETION_RATE', 'TASKS_ON_TIME_RATE', 'TASKS_COMPLETED_COUNT', 'MESSAGE_RESPONSE_TIME_AVG', 'MESSAGE_VOLUME', 'PRESENCE_HOURS', 'PRESENCE_ATTENDANCE_RATE', 'PRESENCE_PUNCTUALITY_RATE', 'AGENT_RESOLUTION_RATE', 'AGENT_CONVERSATION_COUNT', 'CRM_CONTACTS_MANAGED', 'CRM_DEALS_CLOSED', 'CRM_DEALS_VALUE', 'TEAM_TASK_COMPLETION_RATE', 'TEAM_RESPONSE_TIME_AVG', 'TEAM_PRESENCE_RATE', 'DEPT_KPIS_IN_GREEN', 'PIPELINE_CONVERSION_RATE', 'PIPELINE_TOTAL_VALUE', 'PROJECT_MILESTONE_PCT', 'REVENUE_GROWTH_RATE', 'CUSTOMER_RETENTION_RATE', 'COST_REDUCTION_PCT', 'INVENTORY_TURNOVER', 'UNIT_COST_VS_COMPETITOR', 'MANUAL');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('EMPLOYER', 'BOSS', 'SUPPLIER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "Trend" AS ENUM ('UP', 'DOWN', 'STABLE');

-- CreateEnum
CREATE TYPE "RecognitionChannel" AS ENUM ('CAMPUS_PUBLIC_MESSAGE', 'CAMPUS_DIRECT_MESSAGE', 'EMAIL', 'TELEGRAM', 'IN_PERSON');

-- DropIndex
DROP INDEX "Goal_tenant_id_goal_type_idx";

-- AlterTable
ALTER TABLE "TeamSlot" ADD COLUMN     "reports_to_id" TEXT;

-- CreateTable
CREATE TABLE "StrategicPurpose" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vision" TEXT NOT NULL,
    "mission" TEXT,
    "values" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicPurpose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KsfRelationship" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "team_slot_id" TEXT NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "customer_type" "CustomerType",
    "name" TEXT NOT NULL,
    "internal_slot_id" TEXT,
    "expectation" TEXT NOT NULL,
    "discovery_method" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KsfRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuccessArea" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "team_slot_id" TEXT NOT NULL,
    "relationship_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuccessArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeySuccessFactor" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL,
    "level" "KsfLevel" NOT NULL,
    "purpose_id" TEXT,
    "parent_ksf_id" TEXT,
    "dept_id" TEXT,
    "team_slot_id" TEXT,
    "origin" "KsfOrigin" NOT NULL,
    "category" "KsfCategory" NOT NULL,
    "success_area_id" TEXT,
    "measurement_source" "MeasurementSource" NOT NULL,
    "measurement_config" JSONB NOT NULL,
    "measurement_freq" "MeasurementFrequency" NOT NULL,
    "minimum_level" DOUBLE PRECISION NOT NULL,
    "satisfactory_level" DOUBLE PRECISION NOT NULL,
    "outstanding_level" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeySuccessFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KsfMilestone" (
    "id" TEXT NOT NULL,
    "ksf_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_date" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KsfMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationConfig" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "manager_slot_id" TEXT NOT NULL,
    "threshold1_periods" INTEGER NOT NULL DEFAULT 4,
    "threshold1_levels" INTEGER NOT NULL DEFAULT 2,
    "threshold2_periods" INTEGER NOT NULL DEFAULT 8,
    "threshold2_levels" INTEGER NOT NULL DEFAULT 3,
    "rationale" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalMeasurement" (
    "id" TEXT NOT NULL,
    "ksf_id" TEXT NOT NULL,
    "team_slot_id" TEXT,
    "period" TIMESTAMP(3) NOT NULL,
    "actual_value" DOUBLE PRECISION NOT NULL,
    "status" "KsfStatus" NOT NULL,
    "trend" "Trend" NOT NULL,
    "consecutive_above_satisfactory" INTEGER NOT NULL DEFAULT 0,
    "consecutive_below_minimum" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FocusReport" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "target_level" "KsfLevel" NOT NULL,
    "target_id" TEXT NOT NULL,
    "team_slot_id" TEXT,
    "period" TIMESTAMP(3) NOT NULL,
    "ksf_snapshots" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FocusReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackReport" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "team_slot_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "positive_results" JSONB NOT NULL,
    "negative_results" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReport" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "manager_slot_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "zone1_outstanding" JSONB NOT NULL,
    "zone2_positives" JSONB NOT NULL,
    "zone3_chronic" JSONB NOT NULL,
    "zone4_negatives" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecognitionEvent" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "recognizer_id" TEXT NOT NULL,
    "recognized_id" TEXT NOT NULL,
    "ksf_id" TEXT NOT NULL,
    "ksf_name" TEXT NOT NULL,
    "consecutive_periods" INTEGER NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "channel" "RecognitionChannel" NOT NULL,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecognitionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalSetupStatus" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "target_level" "KsfLevel" NOT NULL,
    "target_id" TEXT NOT NULL,
    "team_slot_id" TEXT,
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "missing_categories" TEXT[],
    "unset_goal_levels" TEXT[],
    "has_unique_ksfs" BOOLEAN NOT NULL DEFAULT false,
    "last_checked_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalSetupStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StrategicPurpose_tenant_id_key" ON "StrategicPurpose"("tenant_id");

-- CreateIndex
CREATE INDEX "KsfRelationship_team_slot_id_idx" ON "KsfRelationship"("team_slot_id");

-- CreateIndex
CREATE INDEX "KsfRelationship_tenant_id_idx" ON "KsfRelationship"("tenant_id");

-- CreateIndex
CREATE INDEX "SuccessArea_team_slot_id_idx" ON "SuccessArea"("team_slot_id");

-- CreateIndex
CREATE INDEX "SuccessArea_relationship_id_idx" ON "SuccessArea"("relationship_id");

-- CreateIndex
CREATE INDEX "KeySuccessFactor_tenant_id_level_idx" ON "KeySuccessFactor"("tenant_id", "level");

-- CreateIndex
CREATE INDEX "KeySuccessFactor_team_slot_id_idx" ON "KeySuccessFactor"("team_slot_id");

-- CreateIndex
CREATE INDEX "KeySuccessFactor_dept_id_idx" ON "KeySuccessFactor"("dept_id");

-- CreateIndex
CREATE INDEX "KeySuccessFactor_parent_ksf_id_idx" ON "KeySuccessFactor"("parent_ksf_id");

-- CreateIndex
CREATE INDEX "KsfMilestone_ksf_id_idx" ON "KsfMilestone"("ksf_id");

-- CreateIndex
CREATE UNIQUE INDEX "EscalationConfig_manager_slot_id_key" ON "EscalationConfig"("manager_slot_id");

-- CreateIndex
CREATE INDEX "EscalationConfig_tenant_id_idx" ON "EscalationConfig"("tenant_id");

-- CreateIndex
CREATE INDEX "GoalMeasurement_ksf_id_idx" ON "GoalMeasurement"("ksf_id");

-- CreateIndex
CREATE INDEX "GoalMeasurement_team_slot_id_idx" ON "GoalMeasurement"("team_slot_id");

-- CreateIndex
CREATE INDEX "GoalMeasurement_ksf_id_period_idx" ON "GoalMeasurement"("ksf_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "GoalMeasurement_ksf_id_period_key" ON "GoalMeasurement"("ksf_id", "period");

-- CreateIndex
CREATE INDEX "FocusReport_tenant_id_target_level_idx" ON "FocusReport"("tenant_id", "target_level");

-- CreateIndex
CREATE INDEX "FocusReport_team_slot_id_idx" ON "FocusReport"("team_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "FocusReport_target_id_period_key" ON "FocusReport"("target_id", "period");

-- CreateIndex
CREATE INDEX "FeedbackReport_tenant_id_idx" ON "FeedbackReport"("tenant_id");

-- CreateIndex
CREATE INDEX "FeedbackReport_team_slot_id_idx" ON "FeedbackReport"("team_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackReport_team_slot_id_week_start_key" ON "FeedbackReport"("team_slot_id", "week_start");

-- CreateIndex
CREATE INDEX "ManagementReport_tenant_id_idx" ON "ManagementReport"("tenant_id");

-- CreateIndex
CREATE INDEX "ManagementReport_manager_slot_id_idx" ON "ManagementReport"("manager_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReport_manager_slot_id_week_start_key" ON "ManagementReport"("manager_slot_id", "week_start");

-- CreateIndex
CREATE INDEX "RecognitionEvent_tenant_id_idx" ON "RecognitionEvent"("tenant_id");

-- CreateIndex
CREATE INDEX "RecognitionEvent_recognizer_id_idx" ON "RecognitionEvent"("recognizer_id");

-- CreateIndex
CREATE INDEX "RecognitionEvent_recognized_id_idx" ON "RecognitionEvent"("recognized_id");

-- CreateIndex
CREATE UNIQUE INDEX "GoalSetupStatus_target_id_key" ON "GoalSetupStatus"("target_id");

-- CreateIndex
CREATE UNIQUE INDEX "GoalSetupStatus_team_slot_id_key" ON "GoalSetupStatus"("team_slot_id");

-- CreateIndex
CREATE INDEX "GoalSetupStatus_tenant_id_target_level_idx" ON "GoalSetupStatus"("tenant_id", "target_level");

-- AddForeignKey
ALTER TABLE "TeamSlot" ADD CONSTRAINT "TeamSlot_reports_to_id_fkey" FOREIGN KEY ("reports_to_id") REFERENCES "TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicPurpose" ADD CONSTRAINT "StrategicPurpose_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsfRelationship" ADD CONSTRAINT "KsfRelationship_team_slot_id_fkey" FOREIGN KEY ("team_slot_id") REFERENCES "TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessArea" ADD CONSTRAINT "SuccessArea_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "KsfRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeySuccessFactor" ADD CONSTRAINT "KeySuccessFactor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeySuccessFactor" ADD CONSTRAINT "KeySuccessFactor_purpose_id_fkey" FOREIGN KEY ("purpose_id") REFERENCES "StrategicPurpose"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeySuccessFactor" ADD CONSTRAINT "KeySuccessFactor_parent_ksf_id_fkey" FOREIGN KEY ("parent_ksf_id") REFERENCES "KeySuccessFactor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeySuccessFactor" ADD CONSTRAINT "KeySuccessFactor_team_slot_id_fkey" FOREIGN KEY ("team_slot_id") REFERENCES "TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeySuccessFactor" ADD CONSTRAINT "KeySuccessFactor_success_area_id_fkey" FOREIGN KEY ("success_area_id") REFERENCES "SuccessArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsfMilestone" ADD CONSTRAINT "KsfMilestone_ksf_id_fkey" FOREIGN KEY ("ksf_id") REFERENCES "KeySuccessFactor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationConfig" ADD CONSTRAINT "EscalationConfig_manager_slot_id_fkey" FOREIGN KEY ("manager_slot_id") REFERENCES "TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalMeasurement" ADD CONSTRAINT "GoalMeasurement_ksf_id_fkey" FOREIGN KEY ("ksf_id") REFERENCES "KeySuccessFactor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalMeasurement" ADD CONSTRAINT "GoalMeasurement_team_slot_id_fkey" FOREIGN KEY ("team_slot_id") REFERENCES "TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusReport" ADD CONSTRAINT "FocusReport_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusReport" ADD CONSTRAINT "FocusReport_team_slot_id_fkey" FOREIGN KEY ("team_slot_id") REFERENCES "TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReport" ADD CONSTRAINT "FeedbackReport_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReport" ADD CONSTRAINT "FeedbackReport_team_slot_id_fkey" FOREIGN KEY ("team_slot_id") REFERENCES "TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReport" ADD CONSTRAINT "ManagementReport_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReport" ADD CONSTRAINT "ManagementReport_manager_slot_id_fkey" FOREIGN KEY ("manager_slot_id") REFERENCES "TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecognitionEvent" ADD CONSTRAINT "RecognitionEvent_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecognitionEvent" ADD CONSTRAINT "RecognitionEvent_recognizer_id_fkey" FOREIGN KEY ("recognizer_id") REFERENCES "TeamSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecognitionEvent" ADD CONSTRAINT "RecognitionEvent_recognized_id_fkey" FOREIGN KEY ("recognized_id") REFERENCES "TeamSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalSetupStatus" ADD CONSTRAINT "GoalSetupStatus_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalSetupStatus" ADD CONSTRAINT "GoalSetupStatus_team_slot_id_fkey" FOREIGN KEY ("team_slot_id") REFERENCES "TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
