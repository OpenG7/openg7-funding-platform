CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_event_type
  ON stripe_events (event_type);

CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at
  ON stripe_events (processed_at DESC);

CREATE TABLE IF NOT EXISTS stripe_checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  contribution_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'cad',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_checkout_sessions_payment_intent
  ON stripe_checkout_sessions (stripe_payment_intent_id);

CREATE INDEX IF NOT EXISTS idx_stripe_checkout_sessions_status
  ON stripe_checkout_sessions (status);

CREATE INDEX IF NOT EXISTS idx_stripe_checkout_sessions_created_at
  ON stripe_checkout_sessions (created_at DESC);

CREATE TABLE IF NOT EXISTS fund_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'cad',
  public_name TEXT,
  email_private TEXT,
  public_display_consent BOOLEAN NOT NULL DEFAULT false,
  display_amount_consent BOOLEAN NOT NULL DEFAULT false,
  non_charity_acknowledged BOOLEAN NOT NULL DEFAULT false,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_contributions_stripe_session_id
  ON fund_contributions (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fund_contributions_payment_intent
  ON fund_contributions (stripe_payment_intent_id);

CREATE INDEX IF NOT EXISTS idx_fund_contributions_status
  ON fund_contributions (status);

CREATE INDEX IF NOT EXISTS idx_fund_contributions_paid_at
  ON fund_contributions (paid_at DESC);
