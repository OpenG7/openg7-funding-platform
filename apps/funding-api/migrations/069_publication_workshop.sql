-- Durable private preparation only; no publication, approval or business evidence.
CREATE TABLE preflight_workshop_events (
  contribution_id UUID PRIMARY KEY REFERENCES fund_contributions(id),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  processed_revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (processed_revision BETWEEN 0 AND revision)
);
CREATE TABLE preflight_workshop_missions (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  tenant_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  snapshot_digest TEXT NOT NULL CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
  payload JSONB NOT NULL,
  draft_baseline JSONB NOT NULL,
  delivery TEXT NOT NULL DEFAULT 'queued' CHECK (delivery IN ('queued','sending','acknowledged','uncertain','failed')),
  mission_status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ,
  claim_id UUID,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, contribution_id, source_version)
);
CREATE INDEX preflight_workshop_due ON preflight_workshop_missions(tenant_id,next_attempt_at)
  WHERE delivery <> 'failed';
CREATE TABLE preflight_workshop_proposals (
  id UUID PRIMARY KEY,
  mission_id UUID NOT NULL REFERENCES preflight_workshop_missions(id),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  tenant_id TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  snapshot_digest TEXT NOT NULL,
  proposal JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mission_id,id)
);
CREATE TABLE preflight_workshop_requests (
  request_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  action TEXT NOT NULL CHECK (action IN ('prepare','adopt')),
  actor TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE preflight_workshop_adoptions (
  proposal_id UUID PRIMARY KEY REFERENCES preflight_workshop_proposals(id),
  request_id UUID NOT NULL UNIQUE REFERENCES preflight_workshop_requests(request_id) DEFERRABLE INITIALLY DEFERRED,
  actor TEXT NOT NULL,
  drafts JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER preflight_workshop_proposals_immutable BEFORE UPDATE OR DELETE ON preflight_workshop_proposals
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER preflight_workshop_requests_immutable BEFORE UPDATE OR DELETE ON preflight_workshop_requests
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER preflight_workshop_adoptions_immutable BEFORE UPDATE OR DELETE ON preflight_workshop_adoptions
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE FUNCTION preflight_workshop_capture_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contribution UUID;
BEGIN
  IF TG_TABLE_NAME='fund_contributions' THEN
    IF NEW.contribution_type <> 'sponsorship_interest' THEN RETURN NEW; END IF;
    contribution := NEW.id;
  ELSE
    contribution := NEW.contribution_id;
  END IF;
  INSERT INTO preflight_workshop_events(contribution_id) VALUES(contribution)
    ON CONFLICT(contribution_id) DO UPDATE SET revision=preflight_workshop_events.revision+1,updated_at=NOW();
  RETURN NEW;
END $$;
CREATE TRIGGER preflight_workshop_contribution AFTER INSERT OR UPDATE ON fund_contributions
  FOR EACH ROW EXECUTE FUNCTION preflight_workshop_capture_source();
CREATE TRIGGER preflight_workshop_commitment AFTER INSERT OR UPDATE ON sponsorship_commitments
  FOR EACH ROW EXECUTE FUNCTION preflight_workshop_capture_source();
CREATE TRIGGER preflight_workshop_obligation AFTER INSERT OR UPDATE ON sponsorship_obligations
  FOR EACH ROW EXECUTE FUNCTION preflight_workshop_capture_source();
CREATE TRIGGER preflight_workshop_media AFTER INSERT OR UPDATE ON sponsor_media_assets
  FOR EACH ROW EXECUTE FUNCTION preflight_workshop_capture_source();
CREATE TRIGGER preflight_workshop_editorial AFTER INSERT OR UPDATE ON sponsor_publication_drafts
  FOR EACH ROW EXECUTE FUNCTION preflight_workshop_capture_source();
CREATE TRIGGER preflight_workshop_media_assignment AFTER INSERT OR UPDATE ON sponsor_media_preparation_assignments
  FOR EACH ROW EXECUTE FUNCTION preflight_workshop_capture_source();
CREATE TRIGGER preflight_workshop_documented_consent AFTER INSERT ON admin_sponsorship_consent_records
  FOR EACH ROW EXECUTE FUNCTION preflight_workshop_capture_source();
CREATE FUNCTION preflight_workshop_preserve_mission_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.contribution_id IS DISTINCT FROM OLD.contribution_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.source_version IS DISTINCT FROM OLD.source_version OR NEW.snapshot_digest IS DISTINCT FROM OLD.snapshot_digest
    OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.draft_baseline IS DISTINCT FROM OLD.draft_baseline
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'preflight mission inputs are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preflight_workshop_mission_input BEFORE UPDATE OR DELETE ON preflight_workshop_missions
  FOR EACH ROW EXECUTE FUNCTION preflight_workshop_preserve_mission_input();
