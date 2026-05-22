-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "external_ref" TEXT;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
