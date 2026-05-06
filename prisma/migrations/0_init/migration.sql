-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."MessageType" AS ENUM ('CHAT', 'EMAIL', 'POSTIT', 'ANNOUNCEMENT', 'AGENT_RESPONSE');

-- CreateEnum
CREATE TYPE "public"."SlotStatus" AS ENUM ('ONLINE', 'OFFLINE', 'BUSY', 'AWAY');

-- CreateEnum
CREATE TYPE "public"."SlotType" AS ENUM ('HUMAN', 'AI_AGENT');

-- CreateTable
CREATE TABLE "public"."AgentConversation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "human_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "context" JSONB,
    "summary" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentMemory" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "owner_slot_id" TEXT,
    "memory_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_type" TEXT,
    "source_id" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 5,
    "last_accessed" TIMESTAMP(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentMessage" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "tool_results" JSONB,
    "tokens_used" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "payload" JSONB,
    "ip_address" TEXT,
    "device_info" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarEvent" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "organizer_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "attendees" JSONB,
    "external_id" TEXT,
    "provider" TEXT,
    "recurrence" JSONB,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Certification" (
    "id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "certificate_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Contact" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner_slot_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "position" TEXT,
    "status" TEXT NOT NULL DEFAULT 'lead',
    "tags" JSONB,
    "custom_fields" JSONB,
    "ghl_id" TEXT,
    "chatwoot_id" TEXT,
    "stripe_customer_id" TEXT,
    "meta_psid" TEXT,
    "last_contact_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContactActivity" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "activity_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Course" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cover_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "tags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CourseModule" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "duration_minutes" INTEGER,
    "resources" JSONB,
    "quiz" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CourseProgress" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "modules_completed" JSONB NOT NULL DEFAULT '[]',
    "score" DOUBLE PRECISION,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DashboardConfig" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slot_id" TEXT,
    "dept_id" TEXT,
    "name" TEXT NOT NULL,
    "layout" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DashboardWidget" (
    "id" TEXT NOT NULL,
    "dashboard_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "widget_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "position" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardWidget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Deal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "status" TEXT NOT NULL DEFAULT 'open',
    "expected_close" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Department" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dept_type" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "icon" TEXT,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."File" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "uploader_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "folder_path" TEXT NOT NULL DEFAULT '/',
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "access_list" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Goal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "goal_type" TEXT NOT NULL DEFAULT 'personal',
    "target_value" DOUBLE PRECISION,
    "current_value" DOUBLE PRECISION,
    "unit" TEXT,
    "period" TEXT NOT NULL DEFAULT 'monthly',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IndustryTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "departments" JSONB NOT NULL,
    "rooms" JSONB NOT NULL,
    "agent_slots" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndustryTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Integration" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner_slot_id" TEXT,
    "dept_id" TEXT,
    "integration_scope" TEXT NOT NULL DEFAULT 'tenant',
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "credentials_enc" TEXT,
    "scope" JSONB,
    "config" JSONB,
    "last_sync_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."KnowledgeBase" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dept_id" TEXT,
    "owner_slot_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kb_scope" TEXT NOT NULL DEFAULT 'company',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "kb_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "file_id" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "source_url" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MapProp" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "room_id" TEXT,
    "name" TEXT NOT NULL,
    "prop_type" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 32,
    "height" INTEGER NOT NULL DEFAULT 32,
    "icon_url" TEXT,
    "icon_default" TEXT,
    "action_type" TEXT NOT NULL,
    "action_target" TEXT NOT NULL,
    "tooltip" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapProp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "receiver_id" TEXT,
    "channel_id" TEXT,
    "content" TEXT NOT NULL,
    "type" "public"."MessageType" NOT NULL DEFAULT 'CHAT',
    "metadata" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "action_url" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OnboardingProgress" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "steps_completed" JSONB NOT NULL DEFAULT '[]',
    "template_used" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Pipeline" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pipeline_type" TEXT NOT NULL DEFAULT 'sales',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PipelineStage" (
    "id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "order_index" INTEGER NOT NULL,
    "automations" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Report" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "report_type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3),
    "generated_by" TEXT,
    "result_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Room" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "room_type" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 1,
    "color" TEXT NOT NULL DEFAULT '#E0E7FF',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Schedule" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "check_in_time" TEXT NOT NULL,
    "check_out_time" TEXT NOT NULL,
    "tolerance_minutes" INTEGER NOT NULL DEFAULT 15,
    "work_days" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Task" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "assignee_id" TEXT,
    "department_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "tags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TeamSlot" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT,
    "name" TEXT NOT NULL,
    "type" "public"."SlotType" NOT NULL DEFAULT 'HUMAN',
    "role" TEXT NOT NULL DEFAULT 'employee',
    "avatar_url" TEXT,
    "avatar_config" JSONB,
    "status" "public"."SlotStatus" NOT NULL DEFAULT 'OFFLINE',
    "position_x" INTEGER,
    "position_y" INTEGER,
    "email" TEXT,
    "password_hash" TEXT,
    "schedule_id" TEXT,
    "desk_config" JSONB,
    "agent_config" JSONB,
    "agent_scope" TEXT,
    "agent_role" TEXT,
    "owner_slot_id" TEXT,
    "permissions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#4F46E5',
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "tier" TEXT NOT NULL DEFAULT 'company',
    "max_humans" INTEGER NOT NULL DEFAULT 10,
    "max_agents" INTEGER NOT NULL DEFAULT 20,
    "status" TEXT NOT NULL DEFAULT 'active',
    "campus_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TimeLog" (
    "id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "check_in" TIMESTAMP(3) NOT NULL,
    "check_out" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'on_time',
    "location_lat" DOUBLE PRECISION,
    "location_lng" DOUBLE PRECISION,
    "device_info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentConversation_agent_id_idx" ON "public"."AgentConversation"("agent_id" ASC);

-- CreateIndex
CREATE INDEX "AgentConversation_human_id_idx" ON "public"."AgentConversation"("human_id" ASC);

-- CreateIndex
CREATE INDEX "AgentConversation_session_id_idx" ON "public"."AgentConversation"("session_id" ASC);

-- CreateIndex
CREATE INDEX "AgentConversation_tenant_id_idx" ON "public"."AgentConversation"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "AgentMemory_agent_id_idx" ON "public"."AgentMemory"("agent_id" ASC);

-- CreateIndex
CREATE INDEX "AgentMemory_importance_idx" ON "public"."AgentMemory"("importance" ASC);

-- CreateIndex
CREATE INDEX "AgentMemory_owner_slot_id_idx" ON "public"."AgentMemory"("owner_slot_id" ASC);

-- CreateIndex
CREATE INDEX "AgentMemory_tenant_id_memory_type_idx" ON "public"."AgentMemory"("tenant_id" ASC, "memory_type" ASC);

-- CreateIndex
CREATE INDEX "AgentMessage_conversation_id_created_at_idx" ON "public"."AgentMessage"("conversation_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "AgentMessage_conversation_id_idx" ON "public"."AgentMessage"("conversation_id" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_actor_id_idx" ON "public"."AuditLog"("actor_id" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_resource_type_resource_id_idx" ON "public"."AuditLog"("resource_type" ASC, "resource_id" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_tenant_id_action_idx" ON "public"."AuditLog"("tenant_id" ASC, "action" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_tenant_id_timestamp_idx" ON "public"."AuditLog"("tenant_id" ASC, "timestamp" ASC);

-- CreateIndex
CREATE INDEX "CalendarEvent_organizer_id_idx" ON "public"."CalendarEvent"("organizer_id" ASC);

-- CreateIndex
CREATE INDEX "CalendarEvent_start_at_idx" ON "public"."CalendarEvent"("start_at" ASC);

-- CreateIndex
CREATE INDEX "CalendarEvent_tenant_id_idx" ON "public"."CalendarEvent"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "Certification_course_id_idx" ON "public"."Certification"("course_id" ASC);

-- CreateIndex
CREATE INDEX "Certification_slot_id_idx" ON "public"."Certification"("slot_id" ASC);

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "public"."Contact"("email" ASC);

-- CreateIndex
CREATE INDEX "Contact_owner_slot_id_idx" ON "public"."Contact"("owner_slot_id" ASC);

-- CreateIndex
CREATE INDEX "Contact_phone_idx" ON "public"."Contact"("phone" ASC);

-- CreateIndex
CREATE INDEX "Contact_tenant_id_idx" ON "public"."Contact"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "Contact_tenant_id_status_idx" ON "public"."Contact"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "ContactActivity_contact_id_idx" ON "public"."ContactActivity"("contact_id" ASC);

-- CreateIndex
CREATE INDEX "ContactActivity_tenant_id_activity_type_idx" ON "public"."ContactActivity"("tenant_id" ASC, "activity_type" ASC);

-- CreateIndex
CREATE INDEX "Course_tenant_id_idx" ON "public"."Course"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "Course_tenant_id_status_idx" ON "public"."Course"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "CourseModule_course_id_idx" ON "public"."CourseModule"("course_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CourseProgress_course_id_slot_id_key" ON "public"."CourseProgress"("course_id" ASC, "slot_id" ASC);

-- CreateIndex
CREATE INDEX "CourseProgress_slot_id_idx" ON "public"."CourseProgress"("slot_id" ASC);

-- CreateIndex
CREATE INDEX "DashboardConfig_dept_id_idx" ON "public"."DashboardConfig"("dept_id" ASC);

-- CreateIndex
CREATE INDEX "DashboardConfig_slot_id_idx" ON "public"."DashboardConfig"("slot_id" ASC);

-- CreateIndex
CREATE INDEX "DashboardConfig_tenant_id_idx" ON "public"."DashboardConfig"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "DashboardWidget_dashboard_id_idx" ON "public"."DashboardWidget"("dashboard_id" ASC);

-- CreateIndex
CREATE INDEX "Deal_contact_id_idx" ON "public"."Deal"("contact_id" ASC);

-- CreateIndex
CREATE INDEX "Deal_owner_id_idx" ON "public"."Deal"("owner_id" ASC);

-- CreateIndex
CREATE INDEX "Deal_stage_id_idx" ON "public"."Deal"("stage_id" ASC);

-- CreateIndex
CREATE INDEX "Deal_tenant_id_status_idx" ON "public"."Deal"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "Department_tenant_id_idx" ON "public"."Department"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "File_tenant_id_idx" ON "public"."File"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "File_uploader_id_idx" ON "public"."File"("uploader_id" ASC);

-- CreateIndex
CREATE INDEX "Goal_slot_id_idx" ON "public"."Goal"("slot_id" ASC);

-- CreateIndex
CREATE INDEX "Goal_tenant_id_goal_type_idx" ON "public"."Goal"("tenant_id" ASC, "goal_type" ASC);

-- CreateIndex
CREATE INDEX "Goal_tenant_id_status_idx" ON "public"."Goal"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "IndustryTemplate_slug_key" ON "public"."IndustryTemplate"("slug" ASC);

-- CreateIndex
CREATE INDEX "Integration_dept_id_idx" ON "public"."Integration"("dept_id" ASC);

-- CreateIndex
CREATE INDEX "Integration_owner_slot_id_idx" ON "public"."Integration"("owner_slot_id" ASC);

-- CreateIndex
CREATE INDEX "Integration_tenant_id_provider_idx" ON "public"."Integration"("tenant_id" ASC, "provider" ASC);

-- CreateIndex
CREATE INDEX "KnowledgeBase_dept_id_idx" ON "public"."KnowledgeBase"("dept_id" ASC);

-- CreateIndex
CREATE INDEX "KnowledgeBase_tenant_id_idx" ON "public"."KnowledgeBase"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_kb_id_idx" ON "public"."KnowledgeChunk"("kb_id" ASC);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_tenant_id_idx" ON "public"."KnowledgeChunk"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "MapProp_room_id_idx" ON "public"."MapProp"("room_id" ASC);

-- CreateIndex
CREATE INDEX "MapProp_tenant_id_idx" ON "public"."MapProp"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "Message_receiver_id_idx" ON "public"."Message"("receiver_id" ASC);

-- CreateIndex
CREATE INDEX "Message_sender_id_idx" ON "public"."Message"("sender_id" ASC);

-- CreateIndex
CREATE INDEX "Message_tenant_id_created_at_idx" ON "public"."Message"("tenant_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "Message_tenant_id_type_idx" ON "public"."Message"("tenant_id" ASC, "type" ASC);

-- CreateIndex
CREATE INDEX "Notification_slot_id_read_idx" ON "public"."Notification"("slot_id" ASC, "read" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingProgress_tenant_id_key" ON "public"."OnboardingProgress"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "Pipeline_tenant_id_idx" ON "public"."Pipeline"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "PipelineStage_pipeline_id_idx" ON "public"."PipelineStage"("pipeline_id" ASC);

-- CreateIndex
CREATE INDEX "Report_tenant_id_report_type_idx" ON "public"."Report"("tenant_id" ASC, "report_type" ASC);

-- CreateIndex
CREATE INDEX "Room_tenant_id_idx" ON "public"."Room"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "Schedule_tenant_id_idx" ON "public"."Schedule"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "Task_assignee_id_idx" ON "public"."Task"("assignee_id" ASC);

-- CreateIndex
CREATE INDEX "Task_department_id_idx" ON "public"."Task"("department_id" ASC);

-- CreateIndex
CREATE INDEX "Task_owner_id_idx" ON "public"."Task"("owner_id" ASC);

-- CreateIndex
CREATE INDEX "Task_tenant_id_status_idx" ON "public"."Task"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "TeamSlot_email_idx" ON "public"."TeamSlot"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TeamSlot_email_key" ON "public"."TeamSlot"("email" ASC);

-- CreateIndex
CREATE INDEX "TeamSlot_owner_slot_id_idx" ON "public"."TeamSlot"("owner_slot_id" ASC);

-- CreateIndex
CREATE INDEX "TeamSlot_tenant_id_status_idx" ON "public"."TeamSlot"("tenant_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "TeamSlot_tenant_id_type_idx" ON "public"."TeamSlot"("tenant_id" ASC, "type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "public"."Tenant"("slug" ASC);

-- CreateIndex
CREATE INDEX "TimeLog_slot_id_date_idx" ON "public"."TimeLog"("slot_id" ASC, "date" ASC);

-- AddForeignKey
ALTER TABLE "public"."AgentConversation" ADD CONSTRAINT "AgentConversation_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."TeamSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentConversation" ADD CONSTRAINT "AgentConversation_human_id_fkey" FOREIGN KEY ("human_id") REFERENCES "public"."TeamSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentConversation" ADD CONSTRAINT "AgentConversation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentMemory" ADD CONSTRAINT "AgentMemory_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentMemory" ADD CONSTRAINT "AgentMemory_owner_slot_id_fkey" FOREIGN KEY ("owner_slot_id") REFERENCES "public"."TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentMemory" ADD CONSTRAINT "AgentMemory_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentMessage" ADD CONSTRAINT "AgentMessage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."AgentConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "public"."TeamSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Certification" ADD CONSTRAINT "Certification_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Certification" ADD CONSTRAINT "Certification_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contact" ADD CONSTRAINT "Contact_owner_slot_id_fkey" FOREIGN KEY ("owner_slot_id") REFERENCES "public"."TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contact" ADD CONSTRAINT "Contact_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContactActivity" ADD CONSTRAINT "ContactActivity_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Course" ADD CONSTRAINT "Course_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CourseModule" ADD CONSTRAINT "CourseModule_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CourseProgress" ADD CONSTRAINT "CourseProgress_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CourseProgress" ADD CONSTRAINT "CourseProgress_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DashboardConfig" ADD CONSTRAINT "DashboardConfig_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DashboardConfig" ADD CONSTRAINT "DashboardConfig_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DashboardConfig" ADD CONSTRAINT "DashboardConfig_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DashboardWidget" ADD CONSTRAINT "DashboardWidget_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "public"."DashboardConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deal" ADD CONSTRAINT "Deal_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deal" ADD CONSTRAINT "Deal_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."TeamSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deal" ADD CONSTRAINT "Deal_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deal" ADD CONSTRAINT "Deal_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Department" ADD CONSTRAINT "Department_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Department" ADD CONSTRAINT "Department_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."File" ADD CONSTRAINT "File_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Goal" ADD CONSTRAINT "Goal_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Goal" ADD CONSTRAINT "Goal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Integration" ADD CONSTRAINT "Integration_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Integration" ADD CONSTRAINT "Integration_owner_slot_id_fkey" FOREIGN KEY ("owner_slot_id") REFERENCES "public"."TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Integration" ADD CONSTRAINT "Integration_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_kb_id_fkey" FOREIGN KEY ("kb_id") REFERENCES "public"."KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MapProp" ADD CONSTRAINT "MapProp_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."TeamSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Pipeline" ADD CONSTRAINT "Pipeline_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Pipeline" ADD CONSTRAINT "Pipeline_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PipelineStage" ADD CONSTRAINT "PipelineStage_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Report" ADD CONSTRAINT "Report_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Room" ADD CONSTRAINT "Room_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Schedule" ADD CONSTRAINT "Schedule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."TeamSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamSlot" ADD CONSTRAINT "TeamSlot_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamSlot" ADD CONSTRAINT "TeamSlot_owner_slot_id_fkey" FOREIGN KEY ("owner_slot_id") REFERENCES "public"."TeamSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamSlot" ADD CONSTRAINT "TeamSlot_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamSlot" ADD CONSTRAINT "TeamSlot_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TimeLog" ADD CONSTRAINT "TimeLog_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."TeamSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
