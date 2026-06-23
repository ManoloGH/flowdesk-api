-- CreateTable
CREATE TABLE "Implementation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "client_info" JSONB,
    "phase" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Implementation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImplementationCheckItem" (
    "id" TEXT NOT NULL,
    "implementation_id" TEXT NOT NULL,
    "check_id" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checked_at" TIMESTAMP(3),

    CONSTRAINT "ImplementationCheckItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImplementationNote" (
    "id" TEXT NOT NULL,
    "implementation_id" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImplementationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImplementationFile" (
    "id" TEXT NOT NULL,
    "implementation_id" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImplementationFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImplementationMessage" (
    "id" TEXT NOT NULL,
    "implementation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "phase" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImplementationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Implementation_tenant_id_idx" ON "Implementation"("tenant_id");

-- CreateIndex
CREATE INDEX "Implementation_tenant_id_status_idx" ON "Implementation"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ImplementationCheckItem_implementation_id_idx" ON "ImplementationCheckItem"("implementation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ImplementationCheckItem_implementation_id_check_id_key" ON "ImplementationCheckItem"("implementation_id", "check_id");

-- CreateIndex
CREATE INDEX "ImplementationNote_implementation_id_phase_idx" ON "ImplementationNote"("implementation_id", "phase");

-- CreateIndex
CREATE INDEX "ImplementationFile_implementation_id_idx" ON "ImplementationFile"("implementation_id");

-- CreateIndex
CREATE INDEX "ImplementationMessage_implementation_id_idx" ON "ImplementationMessage"("implementation_id");

-- AddForeignKey
ALTER TABLE "Implementation" ADD CONSTRAINT "Implementation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImplementationCheckItem" ADD CONSTRAINT "ImplementationCheckItem_implementation_id_fkey" FOREIGN KEY ("implementation_id") REFERENCES "Implementation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImplementationNote" ADD CONSTRAINT "ImplementationNote_implementation_id_fkey" FOREIGN KEY ("implementation_id") REFERENCES "Implementation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImplementationFile" ADD CONSTRAINT "ImplementationFile_implementation_id_fkey" FOREIGN KEY ("implementation_id") REFERENCES "Implementation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImplementationMessage" ADD CONSTRAINT "ImplementationMessage_implementation_id_fkey" FOREIGN KEY ("implementation_id") REFERENCES "Implementation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
