-- Additive, no historical notifications and no publication authorization.
ALTER TABLE fund_contributions ADD COLUMN payment_notification_recorded_at TIMESTAMPTZ;
UPDATE fund_contributions SET payment_notification_recorded_at = NOW()
WHERE status IN ('paid','refunded','disputed');

-- Retains confirmed PaymentIntents that arrive before their Checkout session.
CREATE TABLE contribution_payment_confirmations (
  payment_intent_id TEXT PRIMARY KEY,
  paid_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE contribution_activity (
  id BIGSERIAL PRIMARY KEY,
  contribution_id UUID NOT NULL UNIQUE REFERENCES fund_contributions(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_id UUID REFERENCES email_messages(id),
  snapshot JSONB,
  source_version TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE contribution_activity_history (
  activity_id BIGINT NOT NULL REFERENCES contribution_activity(id),
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  reasons JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(activity_id,revision)
);
CREATE TABLE contribution_sms_deliveries (
  activity_id BIGINT PRIMARY KEY REFERENCES contribution_activity(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','captured','failed','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ,
  receipt_id TEXT,
  error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX contribution_sms_due ON contribution_sms_deliveries(status,next_attempt_at);
CREATE TABLE contribution_activity_presentations (
  activity_id BIGINT NOT NULL REFERENCES contribution_activity(id),
  actor TEXT NOT NULL,
  presented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(activity_id,actor)
);
