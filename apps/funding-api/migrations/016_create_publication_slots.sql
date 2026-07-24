CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS publication_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_target TEXT NOT NULL CHECK (feed_target IN ('openg7', 'openg20')),
  channel TEXT NOT NULL CHECK (channel IN ('facebook', 'linkedin')),
  starts_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'scheduled', 'published', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publication_slots_channel_status_starts_at
  ON publication_slots (channel, status, starts_at);

CREATE INDEX IF NOT EXISTS idx_publication_slots_feed_target_starts_at
  ON publication_slots (feed_target, starts_at);

ALTER TABLE sponsor_publication_batches
  ADD COLUMN IF NOT EXISTS slot_id UUID
    REFERENCES publication_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sponsor_publication_batches_slot_id
  ON sponsor_publication_batches (slot_id);

ALTER TABLE sponsor_publication_drafts
  ADD COLUMN IF NOT EXISTS slot_id UUID
    REFERENCES publication_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sponsor_publication_drafts_slot_id
  ON sponsor_publication_drafts (slot_id);
