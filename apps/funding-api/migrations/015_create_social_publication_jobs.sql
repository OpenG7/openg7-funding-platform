CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS social_publication_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES sponsor_publication_batches(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('facebook', 'linkedin')),
  provider TEXT NOT NULL CHECK (provider IN ('facebook', 'linkedin')),
  mode TEXT NOT NULL CHECK (mode IN ('mock', 'live')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  disclosure_text TEXT NOT NULL,
  draft_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  external_post_id TEXT,
  external_post_url TEXT,
  error_code TEXT,
  error_message TEXT,
  attempted_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_publication_jobs_batch_id
  ON social_publication_jobs (batch_id);

CREATE INDEX IF NOT EXISTS idx_social_publication_jobs_channel_status
  ON social_publication_jobs (channel, status);

CREATE INDEX IF NOT EXISTS idx_social_publication_jobs_created_at
  ON social_publication_jobs (created_at DESC);
