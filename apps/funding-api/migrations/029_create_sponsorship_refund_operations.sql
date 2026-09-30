-- Persist intent before contacting Stripe; uncertain results forbid a new claim.
CREATE TABLE sponsorship_refund_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  expected_version TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitting'
    CHECK (status IN ('submitting', 'uncertain', 'pending', 'succeeded', 'failed')),
  stripe_refund_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contribution_id, expected_version)
);

CREATE UNIQUE INDEX sponsorship_refund_operations_one_unresolved
  ON sponsorship_refund_operations (contribution_id)
  WHERE status IN ('submitting', 'uncertain', 'pending');
