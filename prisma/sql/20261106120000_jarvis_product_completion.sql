-- Additive Jarvis completion schema. Review before applying.
-- Do not run this against production from an unattended job.
-- Prefer `npx prisma db push` on an empty or development database.
-- Existing ciphertext is not rewritten or deleted here.
-- Null tenantId rows remain visible only to the default tenant (tenant_zar_labs) in application code.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supabaseUserId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_supabaseUserId_key" ON "User"("supabaseUserId");

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "bouncedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Lead_tenantId_idx" ON "Lead"("tenantId");

ALTER TABLE "OutreachDraft" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "OutreachSequence" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "OutreachReply" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "GoogleConnection" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "AiCredential" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "GmailSenderAccount" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Task_idempotencyKey_key" ON "Task"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Task_status_leaseExpiresAt_idx" ON "Task"("status", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "Task_tenantId_idx" ON "Task"("tenantId");

CREATE TABLE IF NOT EXISTS "Tenant" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key" ON "Tenant"("slug");

CREATE TABLE IF NOT EXISTS "Membership" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "supabaseUserId" TEXT NOT NULL,
  "email" TEXT NOT NULL DEFAULT '',
  "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Membership_tenantId_supabaseUserId_key" ON "Membership"("tenantId", "supabaseUserId");

CREATE TABLE IF NOT EXISTS "TenantSetting" (
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantSetting_pkey" PRIMARY KEY ("tenantId", "key")
);

CREATE TABLE IF NOT EXISTS "DeliveryEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "email" TEXT,
  "leadId" TEXT,
  "draftId" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryEvent_provider_providerEventId_key" ON "DeliveryEvent"("provider", "providerEventId");

CREATE TABLE IF NOT EXISTS "UsageEntry" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'committed',
  "idempotencyKey" TEXT NOT NULL,
  "draftId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UsageEntry_tenantId_idempotencyKey_key" ON "UsageEntry"("tenantId", "idempotencyKey");
