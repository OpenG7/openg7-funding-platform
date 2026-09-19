-- Additional private links leave an existing valid session usable.
CREATE TABLE sponsorship_access_tokens (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  email_message_id UUID NOT NULL REFERENCES email_messages(id),
  CHECK (expires_at > created_at)
);
CREATE INDEX idx_sponsorship_access_contribution ON sponsorship_access_tokens (contribution_id, created_at DESC);

-- Revisions survive submission/discard, so a stale tab cannot recreate a draft.
CREATE TABLE sponsorship_followup_drafts (
  contribution_id UUID PRIMARY KEY REFERENCES fund_contributions(id),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  data JSONB CHECK (data IS NULL OR jsonb_typeof(data) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
