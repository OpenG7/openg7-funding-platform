-- Existing terms remain immutable. No historical date, exposure or fulfilment is inferred.
CREATE TABLE sponsorship_obligation_timing (
  obligation_id UUID PRIMARY KEY REFERENCES sponsorship_obligations(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  deadline_days INTEGER CHECK (deadline_days BETWEEN 1 AND 3650),
  duration_days INTEGER CHECK (duration_days BETWEEN 1 AND 3650),
  origin_at TIMESTAMPTZ,
  origin_provenance TEXT CHECK (origin_provenance IN ('activation','owner_recorded')),
  due_at TIMESTAMPTZ,
  CHECK ((origin_at IS NULL) = (origin_provenance IS NULL)),
  CHECK ((due_at IS NULL) = (origin_at IS NULL OR deadline_days IS NULL)),
  CHECK (due_at IS NULL OR due_at = origin_at + deadline_days * INTERVAL '24 hours')
);
INSERT INTO sponsorship_obligation_timing(obligation_id,deadline_days,duration_days)
SELECT ob.id,(b->>'deadlineDays')::integer,(b->>'durationDays')::integer
FROM sponsorship_obligations ob JOIN sponsorship_commitments m ON m.id=ob.commitment_id
JOIN sponsorship_offers o ON o.id=m.offer_id
CROSS JOIN LATERAL jsonb_array_elements(o.snapshot->'benefits') b
WHERE b->>'id'=ob.benefit_id;
CREATE INDEX sponsorship_obligation_timing_due ON sponsorship_obligation_timing(due_at,obligation_id) WHERE due_at IS NOT NULL;
CREATE FUNCTION protect_sponsorship_obligation_timing() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'sponsorship timing history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF OLD.obligation_id IS DISTINCT FROM NEW.obligation_id
    OR OLD.deadline_days IS DISTINCT FROM NEW.deadline_days
    OR OLD.duration_days IS DISTINCT FROM NEW.duration_days
    OR (OLD.origin_at IS NOT NULL AND (OLD.origin_at IS DISTINCT FROM NEW.origin_at
      OR OLD.origin_provenance IS DISTINCT FROM NEW.origin_provenance OR OLD.due_at IS DISTINCT FROM NEW.due_at))
    OR NEW.version <> OLD.version+1 THEN
    RAISE EXCEPTION 'sponsorship timing is immutable once recorded' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sponsorship_obligation_timing_immutable BEFORE UPDATE OR DELETE ON sponsorship_obligation_timing
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_obligation_timing();

CREATE TABLE sponsorship_website_exposure_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id UUID NOT NULL REFERENCES sponsorship_obligations(id),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  obligation_version INTEGER NOT NULL CHECK (obligation_version > 0),
  content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  message TEXT NOT NULL,
  source_snapshot JSONB NOT NULL,
  media_snapshot JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor TEXT NOT NULL,
  FOREIGN KEY (obligation_id,contribution_id) REFERENCES sponsorship_obligations(id,contribution_id),
  UNIQUE(id,obligation_id)
);
CREATE INDEX sponsorship_website_exposure_latest ON sponsorship_website_exposure_observations(obligation_id,observed_at DESC,id);
CREATE TRIGGER sponsorship_website_exposure_immutable BEFORE UPDATE OR DELETE ON sponsorship_website_exposure_observations
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();

CREATE TABLE sponsorship_obligation_duration_attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id UUID NOT NULL UNIQUE REFERENCES sponsorship_obligations(id),
  fulfilment_evidence_id UUID NOT NULL,
  start_observation_id UUID NOT NULL,
  end_observation_id UUID NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor TEXT NOT NULL,
  supporting_evidence_reference TEXT NOT NULL CHECK (length(btrim(supporting_evidence_reference)) BETWEEN 1 AND 2000),
  continuity_confirmed BOOLEAN NOT NULL CHECK (continuity_confirmed IS TRUE),
  FOREIGN KEY (fulfilment_evidence_id,obligation_id) REFERENCES sponsorship_fulfilment_evidence(id,obligation_id),
  FOREIGN KEY (start_observation_id,obligation_id) REFERENCES sponsorship_website_exposure_observations(id,obligation_id),
  FOREIGN KEY (end_observation_id,obligation_id) REFERENCES sponsorship_website_exposure_observations(id,obligation_id),
  CHECK (start_observation_id <> end_observation_id)
);
CREATE TRIGGER sponsorship_obligation_duration_immutable BEFORE UPDATE OR DELETE ON sponsorship_obligation_duration_attestations
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();

ALTER TABLE sponsorship_commitment_changes DROP CONSTRAINT sponsorship_commitment_changes_kind_check;
ALTER TABLE sponsorship_commitment_changes ADD CONSTRAINT sponsorship_commitment_changes_kind_check
  CHECK(kind IN ('qualification','destination','waiver','format','timing_origin','duration_observation','duration_attestation'));
