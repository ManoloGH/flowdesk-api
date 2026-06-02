-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "EmpresaBrainDocument" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmpresaBrainDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmpresaBrainDocument_tenant_id_source_type_idx" ON "EmpresaBrainDocument"("tenant_id", "source_type");

-- CreateIndex for vector similarity search (HNSW — fast approximate nearest neighbor)
CREATE INDEX "EmpresaBrainDocument_embedding_idx" ON "EmpresaBrainDocument" USING hnsw (embedding vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "EmpresaBrainDocument" ADD CONSTRAINT "EmpresaBrainDocument_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
