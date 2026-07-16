-- CreateTable (idempotente: no falla si ya existe)
CREATE TABLE IF NOT EXISTS "bot_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "contact_name" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'AI',
    "instance_name" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bot_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "bot_conversations_tenant_id_phone_key" ON "bot_conversations"("tenant_id", "phone");

-- AddForeignKey (sin error si ya existe)
DO $$ BEGIN
  ALTER TABLE "bot_conversations" ADD CONSTRAINT "bot_conversations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_messages" ADD CONSTRAINT "bot_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "bot_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
