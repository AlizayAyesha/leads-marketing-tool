-- Content Agent drafts (v0.2).
-- The app applies schema changes with `npm run db:push` (`prisma db push`).
-- This SQL is the same change for a database that already has the v0.1 tables.

-- CreateEnum
CREATE TYPE "ContentPlatform" AS ENUM ('X', 'LINKEDIN', 'INSTAGRAM', 'TIKTOK', 'REDDIT', 'FACEBOOK', 'THREADS');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('POST', 'COMMENT', 'DM');

-- CreateTable
CREATE TABLE "ContentDraft" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "platform" "ContentPlatform" NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "topic" TEXT,
    "context" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "notes" TEXT,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "rejectionReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "editedAt" TIMESTAMP(3),
    "mode" TEXT NOT NULL DEFAULT 'heuristic',
    "modelProvider" TEXT,
    "skillId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentDraft_status_createdAt_idx" ON "ContentDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentDraft_platform_idx" ON "ContentDraft"("platform");

-- CreateIndex
CREATE INDEX "ContentDraft_leadId_idx" ON "ContentDraft"("leadId");

-- AddForeignKey
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
