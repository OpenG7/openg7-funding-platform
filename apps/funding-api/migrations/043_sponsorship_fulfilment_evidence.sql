-- An approval names exact obligations. Older authorizations need a fresh review;
-- their historical publication flags are not provider evidence.
ALTER TABLE publication_deliveries ADD COLUMN obligation_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(obligation_snapshot) = 'array');

CREATE TABLE sponsorship_obligation_reservations (
  obligation_id UUID PRIMARY KEY REFERENCES sponsorship_obligations(id),
  delivery_id UUID NOT NULL REFERENCES publication_deliveries(id) ON DELETE CASCADE,
  obligation_version INTEGER NOT NULL CHECK (obligation_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_sponsorship_obligation_reservations_delivery ON sponsorship_obligation_reservations(delivery_id);
ALTER TABLE sponsorship_obligations ADD CONSTRAINT sponsorship_obligation_contribution_pair UNIQUE(id, contribution_id);

CREATE TABLE sponsorship_fulfilment_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id UUID NOT NULL UNIQUE REFERENCES sponsorship_obligations(id),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  obligation_version INTEGER NOT NULL CHECK (obligation_version > 0),
  channel TEXT NOT NULL CHECK (channel IN ('website', 'facebook', 'linkedin')),
  target TEXT NOT NULL CHECK (target IN ('openg7', 'openg20')),
  delivery_id UUID REFERENCES publication_deliveries(id),
  delivery_version INTEGER CHECK (delivery_version > 0),
  mode TEXT NOT NULL CHECK (mode = 'live'),
  account_id TEXT NOT NULL CHECK (length(btrim(account_id)) > 0),
  provenance TEXT NOT NULL CHECK (provenance IN ('provider_acknowledged', 'provider_verified', 'website_verified')),
  external_post_id TEXT,
  external_post_url TEXT,
  message TEXT NOT NULL,
  source_snapshot JSONB NOT NULL,
  media_snapshot JSONB,
  content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  delivered_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor TEXT NOT NULL,
  UNIQUE (id, obligation_id),
  UNIQUE (contribution_id, channel, target, external_post_id),
  FOREIGN KEY (obligation_id, contribution_id) REFERENCES sponsorship_obligations(id, contribution_id),
  CHECK ((channel = 'website') = (provenance = 'website_verified')),
  CHECK ((channel = 'website' AND delivery_id IS NULL AND delivery_version IS NULL
    AND external_post_id IS NULL AND target = 'openg7') OR
    (channel <> 'website' AND delivery_id IS NOT NULL AND delivery_version IS NOT NULL
      AND external_post_id IS NOT NULL))
);
ALTER TABLE sponsorship_obligations ADD CONSTRAINT sponsorship_obligation_evidence_owner
  FOREIGN KEY (fulfilment_evidence_id, id) REFERENCES sponsorship_fulfilment_evidence(id, obligation_id);
CREATE TRIGGER sponsorship_fulfilment_evidence_immutable BEFORE UPDATE OR DELETE ON sponsorship_fulfilment_evidence
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();

-- Visibility observations preserve the delivered fact. Inaccessible reads are
-- unknown, and no observation authorizes a replacement send or a refund.
CREATE TABLE sponsorship_fulfilment_visibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES sponsorship_fulfilment_evidence(id),
  request_id UUID NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL CHECK (state IN ('visible', 'missing', 'changed', 'unknown')),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  UNIQUE (evidence_id, request_id)
);
CREATE INDEX idx_sponsorship_fulfilment_visibility_latest ON sponsorship_fulfilment_visibility(evidence_id, observed_at DESC, id);
CREATE TRIGGER sponsorship_fulfilment_visibility_immutable BEFORE UPDATE OR DELETE ON sponsorship_fulfilment_visibility
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
