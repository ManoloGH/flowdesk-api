-- CreateTable
CREATE TABLE "VaultEntry" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key_name" TEXT NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultAccessLog" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "accessor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaultEntry_tenant_id_key_name_key" ON "VaultEntry"("tenant_id", "key_name");

-- CreateIndex
CREATE INDEX "VaultEntry_tenant_id_category_idx" ON "VaultEntry"("tenant_id", "category");

-- CreateIndex
CREATE INDEX "VaultAccessLog_entry_id_idx" ON "VaultAccessLog"("entry_id");

-- AddForeignKey
ALTER TABLE "VaultEntry" ADD CONSTRAINT "VaultEntry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultAccessLog" ADD CONSTRAINT "VaultAccessLog_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "VaultEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
