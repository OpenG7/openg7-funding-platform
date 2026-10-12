-- Reviews acknowledge historical observations without rewriting evidence,
-- obligations, publication authorizations, visibility or financial facts.
CREATE TABLE sponsorship_historical_evidence_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES sponsorship_fulfilment_evidence(id),
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  review_version INTEGER NOT NULL CHECK (review_version > 0),
  conclusion TEXT NOT NULL CHECK (conclusion IN ('confirmed', 'follow_up_required', 'inconclusive')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  actor TEXT NOT NULL CHECK (length(btrim(actor)) > 0),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (evidence_id, review_version)
);
CREATE INDEX idx_sponsorship_historical_evidence_reviews_latest
  ON sponsorship_historical_evidence_reviews(evidence_id, review_version DESC);
CREATE INDEX idx_sponsorship_fulfilment_evidence_recorded
  ON sponsorship_fulfilment_evidence(recorded_at, id);
CREATE TRIGGER sponsorship_historical_evidence_reviews_immutable
  BEFORE UPDATE OR DELETE ON sponsorship_historical_evidence_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
