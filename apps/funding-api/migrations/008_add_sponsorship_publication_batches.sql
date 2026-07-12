CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sponsor_publication_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'open',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sponsor_publication_batches_channel_status
  ON sponsor_publication_batches (channel, status);

CREATE INDEX IF NOT EXISTS idx_sponsor_publication_batches_scheduled_at
  ON sponsor_publication_batches (scheduled_at);

ALTER TABLE sponsor_publication_drafts
  ADD COLUMN IF NOT EXISTS batch_id UUID
    REFERENCES sponsor_publication_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sponsor_publication_drafts_batch_id
  ON sponsor_publication_drafts (batch_id);
