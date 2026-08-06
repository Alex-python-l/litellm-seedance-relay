CREATE TABLE "LiteLLM_PublicRelayVideoTask" (
    "video_task_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "idempotency_hash" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "provider_task_id" TEXT NOT NULL,
    "provider_internal_task_id" TEXT,
    "model_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "duration" INTEGER NOT NULL,
    "resolution" TEXT NOT NULL,
    "ratio" TEXT NOT NULL,
    "generate_audio" BOOLEAN NOT NULL,
    "estimated_tokens" INTEGER NOT NULL,
    "actual_tokens" INTEGER,
    "charged_micros" BIGINT NOT NULL DEFAULT 0,
    "upstream_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "provider_response" JSONB NOT NULL DEFAULT '{}',
    "provider_error" TEXT,
    "last_polled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiteLLM_PublicRelayVideoTask_pkey" PRIMARY KEY ("video_task_id"),
    CONSTRAINT "LiteLLM_PublicRelayVideoTask_tokens_nonnegative" CHECK (
        "estimated_tokens" >= 0
        AND ("actual_tokens" IS NULL OR "actual_tokens" >= 0)
        AND "charged_micros" >= 0
        AND "upstream_cost_micros" >= 0
    )
);

CREATE UNIQUE INDEX "LiteLLM_PublicRelayVideoTask_request_id_key"
ON "LiteLLM_PublicRelayVideoTask"("request_id");

CREATE UNIQUE INDEX "LiteLLM_PublicRelayVideoTask_provider_task_id_key"
ON "LiteLLM_PublicRelayVideoTask"("provider_task_id");

CREATE UNIQUE INDEX "LiteLLM_PublicRelayVideoTask_account_id_idempotency_hash_key"
ON "LiteLLM_PublicRelayVideoTask"("account_id", "idempotency_hash");

CREATE INDEX "LiteLLM_PublicRelayVideoTask_account_id_created_at_idx"
ON "LiteLLM_PublicRelayVideoTask"("account_id", "created_at");

CREATE INDEX "LiteLLM_PublicRelayVideoTask_status_last_polled_at_idx"
ON "LiteLLM_PublicRelayVideoTask"("status", "last_polled_at");

CREATE INDEX "LiteLLM_PublicRelayVideoTask_provider_internal_task_id_idx"
ON "LiteLLM_PublicRelayVideoTask"("provider_internal_task_id");

ALTER TABLE "LiteLLM_PublicRelayVideoTask"
ADD CONSTRAINT "LiteLLM_PublicRelayVideoTask_account_id_fkey"
FOREIGN KEY ("account_id") REFERENCES "LiteLLM_PublicRelayAccount"("account_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "LiteLLM_VerificationToken"
SET "allowed_routes" = ARRAY['public_relay_routes']::TEXT[]
WHERE COALESCE(("metadata"->>'public_relay')::BOOLEAN, false) = true;
