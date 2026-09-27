CREATE TABLE admin_stripe_backfills (
  id UUID PRIMARY KEY,
  actor TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preview', 'running', 'completed', 'failed', 'interrupted')),
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  scope JSONB NOT NULL,
  created_range JSONB NOT NULL,
  counts JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX admin_stripe_backfills_actor ON admin_stripe_backfills(actor, created_at DESC);
