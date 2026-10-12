-- Commercial terms are captured before Stripe, independently of payment/review/publication.
CREATE TABLE sponsorship_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_operation_id UUID UNIQUE REFERENCES checkout_operations(id),
  public_reference TEXT NOT NULL,
  version TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 9007199254740991),
  currency TEXT NOT NULL CHECK (currency = 'CAD'),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  provenance TEXT NOT NULL CHECK (provenance IN ('checkout', 'historical_qualification')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((provenance = 'checkout') = (checkout_operation_id IS NOT NULL)),
  CHECK ((snapshot->>'version' = version AND snapshot->>'amountMinor' = amount_minor::text
    AND snapshot->>'currency' = currency AND jsonb_typeof(snapshot->'benefits') = 'array') IS TRUE)
);
CREATE TABLE sponsorship_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL UNIQUE REFERENCES fund_contributions(id),
  offer_id UUID UNIQUE REFERENCES sponsorship_offers(id),
  provenance TEXT NOT NULL CHECK (provenance IN ('accepted_offer', 'historical_unverified', 'qualified_historical')),
  state TEXT NOT NULL CHECK (state IN ('active', 'needs_confirmation')),
  qualification_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, contribution_id),
  CHECK ((state = 'active') = (offer_id IS NOT NULL)),
  CHECK ((provenance = 'historical_unverified') = (state = 'needs_confirmation')),
  CHECK (state <> 'active' OR activated_at IS NOT NULL)
);
CREATE TABLE sponsorship_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES sponsorship_commitments(id),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  benefit_id TEXT NOT NULL CHECK (benefit_id IN ('website_mention', 'facebook_batch', 'linkedin_batch')),
  channel TEXT NOT NULL CHECK (channel IN ('website', 'facebook', 'linkedin')),
  target TEXT NOT NULL CHECK (target IN ('openg7', 'openg20')),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'blocked', 'fulfilled', 'adjusted')),
  blocked_reason TEXT,
  fulfilment_evidence_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commitment_id, benefit_id, ordinal),
  FOREIGN KEY (commitment_id, contribution_id) REFERENCES sponsorship_commitments(id, contribution_id),
  CHECK (state <> 'fulfilled' OR fulfilment_evidence_id IS NOT NULL),
  CHECK ((benefit_id = 'website_mention' AND channel = 'website') OR
         (benefit_id = 'facebook_batch' AND channel = 'facebook') OR
         (benefit_id = 'linkedin_batch' AND channel = 'linkedin'))
);
CREATE INDEX idx_sponsorship_obligations_contribution ON sponsorship_obligations(contribution_id, channel, target);
CREATE INDEX idx_sponsorship_obligations_open ON sponsorship_obligations(state) WHERE state IN ('pending', 'blocked');
CREATE TABLE sponsorship_commitment_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  commitment_id UUID NOT NULL REFERENCES sponsorship_commitments(id),
  obligation_id UUID REFERENCES sponsorship_obligations(id),
  kind TEXT NOT NULL CHECK (kind IN ('qualification', 'destination', 'waiver')),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  evidence_reference TEXT,
  previous_value JSONB NOT NULL,
  resulting_value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind <> 'qualification' OR (evidence_reference IS NOT NULL AND length(btrim(evidence_reference)) BETWEEN 1 AND 2000))
);
CREATE FUNCTION protect_sponsorship_commitment_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sponsorship commercial history is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER sponsorship_offers_immutable BEFORE UPDATE OR DELETE ON sponsorship_offers
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER sponsorship_commitment_changes_immutable BEFORE UPDATE OR DELETE ON sponsorship_commitment_changes
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();

-- Existing financial facts remain intact. No current price list is retroactively promised.
INSERT INTO sponsorship_commitments(contribution_id, provenance, state, qualification_reason)
SELECT id, 'historical_unverified', 'needs_confirmation', 'historical_offer_not_recorded'
FROM fund_contributions
WHERE contribution_type = 'sponsorship_interest' AND status IN ('paid', 'refunded', 'disputed')
ON CONFLICT (contribution_id) DO NOTHING;
