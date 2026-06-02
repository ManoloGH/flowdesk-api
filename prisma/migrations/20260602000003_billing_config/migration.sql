-- CreateTable
CREATE TABLE "BillingConfig" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "stripe_account_id" TEXT,
    "facturapi_org_id" TEXT,
    "rfc" TEXT,
    "fiscal_regime" TEXT,
    "legal_name" TEXT,
    "tax_zip" TEXT,
    "invoice_series" TEXT DEFAULT 'A',
    "payment_conditions" TEXT DEFAULT 'PUE',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingConfig_tenant_id_key" ON "BillingConfig"("tenant_id");

-- AddForeignKey
ALTER TABLE "BillingConfig" ADD CONSTRAINT "BillingConfig_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
