-- AlterTable Tenant: add ADN fields
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "secondary_color" TEXT,
  ADD COLUMN IF NOT EXISTS "tagline" TEXT,
  ADD COLUMN IF NOT EXISTS "industry" TEXT,
  ADD COLUMN IF NOT EXISTS "mission" TEXT,
  ADD COLUMN IF NOT EXISTS "vision" TEXT,
  ADD COLUMN IF NOT EXISTS "website" TEXT;

-- AlterTable Tenant: convert tenant_type from enum to String
ALTER TABLE "Tenant" ALTER COLUMN "tenant_type" TYPE TEXT USING "tenant_type"::TEXT;
ALTER TABLE "Tenant" ALTER COLUMN "tenant_type" DROP NOT NULL;
ALTER TABLE "Tenant" ALTER COLUMN "tenant_type" SET DEFAULT 'company';

-- AlterTable Tenant: drop obsolete Stripe/billing columns
ALTER TABLE "Tenant"
  DROP COLUMN IF EXISTS "airtable_project_id",
  DROP COLUMN IF EXISTS "billing_email",
  DROP COLUMN IF EXISTS "current_period_end",
  DROP COLUMN IF EXISTS "employee_desks_enabled",
  DROP COLUMN IF EXISTS "external_ref",
  DROP COLUMN IF EXISTS "stripe_customer_id",
  DROP COLUMN IF EXISTS "stripe_sub_status",
  DROP COLUMN IF EXISTS "stripe_subscription_id";

-- Drop TenantType enum (no longer used)
DROP TYPE IF EXISTS "TenantType";

-- AlterTable TeamSlot: add access_token (re-declaring existing column — idempotent)
ALTER TABLE "TeamSlot" ADD COLUMN IF NOT EXISTS "access_token" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "TeamSlot_access_token_key" ON "TeamSlot"("access_token");

-- AlterTable TeamSlot: convert desk_access from DeskAccess enum to String
ALTER TABLE "TeamSlot" ALTER COLUMN "desk_access" TYPE TEXT USING "desk_access"::TEXT;
ALTER TABLE "TeamSlot" ALTER COLUMN "desk_access" DROP NOT NULL;
ALTER TABLE "TeamSlot" ALTER COLUMN "desk_access" SET DEFAULT 'FULL';

-- Drop DeskAccess enum (no longer used)
DROP TYPE IF EXISTS "DeskAccess";
