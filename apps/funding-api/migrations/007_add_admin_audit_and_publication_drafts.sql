CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL DEFAULT 'admin-token',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
  ON admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity
  ON admin_audit_log (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
  ON admin_audit_log (action);

CREATE TABLE IF NOT EXISTS sponsor_publication_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id) ON DELETE CASCADE,
  feed_target TEXT NOT NULL,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  disclosure_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  public_url TEXT,
  scheduled_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_publication_drafts_unique_channel
  ON sponsor_publication_drafts (contribution_id, feed_target, channel);

CREATE INDEX IF NOT EXISTS idx_sponsor_publication_drafts_status
  ON sponsor_publication_drafts (status);

CREATE INDEX IF NOT EXISTS idx_sponsor_publication_drafts_updated_at
  ON sponsor_publication_drafts (updated_at DESC);
