CREATE TABLE IF NOT EXISTS fund_transactions (
  id BIGSERIAL PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  stripe_object_id TEXT NOT NULL,
  stripe_balance_transaction_id TEXT,
  type TEXT NOT NULL,
  amount BIGINT NOT NULL,
  fee BIGINT NOT NULL DEFAULT 0,
  net BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  public_category TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fund_transactions_created_at
  ON fund_transactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fund_transactions_type
  ON fund_transactions (type);

CREATE TABLE IF NOT EXISTS fund_allocations (
  id BIGSERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  public_description TEXT NOT NULL,
  amount_allocated BIGINT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fund_allocations_published_at
  ON fund_allocations (published_at DESC);
