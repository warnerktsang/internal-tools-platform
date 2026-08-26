-- CreateTable
CREATE TABLE "public"."principals" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT NOT NULL,
    "title" TEXT,
    "roles" TEXT[],
    "scopes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "principals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_events" (
    "seq" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRoles" TEXT[],
    "actorScope" JSONB NOT NULL,
    "resource" TEXT NOT NULL,
    "recordId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "fields" TEXT[],
    "reason" TEXT,
    "requestId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "txId" BIGINT NOT NULL,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "public"."approval_requests" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "policy" TEXT NOT NULL,
    "requiredApprovers" INTEGER NOT NULL,
    "eligibleRoles" TEXT[],
    "excludeRequester" BOOLEAN NOT NULL DEFAULT true,
    "requesterId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."approvals" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."idempotency_records" (
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "recordId" TEXT,
    "action" TEXT NOT NULL,
    "outcome" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."effects" (
    "id" TEXT NOT NULL,
    "port" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "lastError" TEXT,
    "resource" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "effects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."kyc_cases" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "ssn" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "address" TEXT NOT NULL,
    "nationality" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'new',
    "assigneeId" TEXT,
    "decisionReason" TEXT,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."kyc_documents" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."kyc_notes" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payments" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "capturedMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "processorRef" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."refunds" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "state" TEXT NOT NULL DEFAULT 'draft',
    "reason" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "processorRef" TEXT,
    "unknownSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."processor_events" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "refundRef" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "disposition" TEXT,

    CONSTRAINT "processor_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."flag_configs" (
    "id" TEXT NOT NULL,
    "flagId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPct" INTEGER NOT NULL DEFAULT 0,
    "targeting" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishState" TEXT NOT NULL DEFAULT 'published',
    "publishedVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flag_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "principals_email_key" ON "public"."principals"("email");

-- CreateIndex
CREATE INDEX "audit_events_resource_recordId_seq_idx" ON "public"."audit_events"("resource", "recordId", "seq");

-- CreateIndex
CREATE INDEX "audit_events_actorId_seq_idx" ON "public"."audit_events"("actorId", "seq");

-- CreateIndex
CREATE INDEX "audit_events_kind_seq_idx" ON "public"."audit_events"("kind", "seq");

-- CreateIndex
CREATE INDEX "approval_requests_state_createdAt_idx" ON "public"."approval_requests"("state", "createdAt");

-- CreateIndex
CREATE INDEX "approval_requests_resource_recordId_idx" ON "public"."approval_requests"("resource", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_requestId_approverId_key" ON "public"."approvals"("requestId", "approverId");

-- CreateIndex
CREATE UNIQUE INDEX "effects_idempotencyKey_key" ON "public"."effects"("idempotencyKey");

-- CreateIndex
CREATE INDEX "effects_state_nextAttemptAt_idx" ON "public"."effects"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_cases_reference_key" ON "public"."kyc_cases"("reference");

-- CreateIndex
CREATE INDEX "kyc_cases_businessUnitId_state_idx" ON "public"."kyc_cases"("businessUnitId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "public"."payments"("reference");

-- CreateIndex
CREATE INDEX "payments_businessUnitId_idx" ON "public"."payments"("businessUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_reference_key" ON "public"."refunds"("reference");

-- CreateIndex
CREATE INDEX "refunds_businessUnitId_state_idx" ON "public"."refunds"("businessUnitId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "processor_events_externalId_key" ON "public"."processor_events"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "flags_key_key" ON "public"."flags"("key");

-- CreateIndex
CREATE INDEX "flag_configs_environment_idx" ON "public"."flag_configs"("environment");

-- CreateIndex
CREATE UNIQUE INDEX "flag_configs_flagId_environment_key" ON "public"."flag_configs"("flagId", "environment");

-- AddForeignKey
ALTER TABLE "public"."approvals" ADD CONSTRAINT "approvals_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."kyc_documents" ADD CONSTRAINT "kyc_documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."kyc_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."kyc_notes" ADD CONSTRAINT "kyc_notes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."kyc_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."flag_configs" ADD CONSTRAINT "flag_configs_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "public"."flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
