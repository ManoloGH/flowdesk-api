-- DropIndex
DROP INDEX "EmpresaBrainDocument_embedding_idx";

-- AlterTable
ALTER TABLE "TeamSlot" ADD COLUMN     "whatsapp_phone" TEXT;

-- AlterTable
ALTER TABLE "VaultEntry" ALTER COLUMN "category" DROP DEFAULT;
