-- AlterTable
ALTER TABLE "TeamSlot" ADD COLUMN "google_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TeamSlot_google_id_key" ON "TeamSlot"("google_id");
