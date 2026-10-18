-- Private, local preparation assistance. No existing record is qualified or dispatched.
CREATE TABLE preparation_assistance_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  source_text TEXT NOT NULL CHECK (length(btrim(source_text)) BETWEEN 1 AND 16000),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'
    AND fingerprint=encode(digest(source_text,'sha256'),'hex')),
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (contribution_id, version),
  UNIQUE (id, contribution_id, version)
);

CREATE TABLE preparation_assistance_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  source_id UUID NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  commitment_version INTEGER NOT NULL CHECK (commitment_version > 0),
  adapter TEXT NOT NULL CHECK (adapter = 'local_rules_v1'),
  generation INTEGER NOT NULL CHECK (generation > 0),
  requested_by TEXT NOT NULL CHECK (length(btrim(requested_by)) BETWEEN 1 AND 200),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','processing','succeeded','failed','cancelled')),
  phase TEXT NOT NULL DEFAULT 'queued'
    CHECK (phase IN ('queued','extracting','verifying','finished')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT CHECK (error_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  FOREIGN KEY (source_id, contribution_id, source_version)
    REFERENCES preparation_assistance_sources(id, contribution_id, version),
  UNIQUE (source_id, commitment_version, adapter, generation),
  UNIQUE (id, contribution_id),
  CHECK ((state='processing') = (claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((state IN ('succeeded','failed','cancelled')) = (finished_at IS NOT NULL))
);
CREATE INDEX preparation_assistance_runs_queue ON preparation_assistance_runs(created_at,id)
  WHERE state IN ('queued','processing');
CREATE INDEX preparation_assistance_runs_dossier ON preparation_assistance_runs(contribution_id,created_at DESC,id);

CREATE TABLE preparation_assistance_suggestions (
  run_id UUID PRIMARY KEY REFERENCES preparation_assistance_runs(id),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE preparation_assistance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL,
  run_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  decision TEXT NOT NULL CHECK (decision IN ('saved','rejected','accepted')),
  draft JSONB NOT NULL CHECK (jsonb_typeof(draft)='object'),
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  request_id UUID NOT NULL UNIQUE,
  applied_commitment_version INTEGER CHECK (applied_commitment_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (run_id, contribution_id) REFERENCES preparation_assistance_runs(id, contribution_id),
  UNIQUE (run_id,version),
  CHECK ((decision='accepted') = (applied_commitment_version IS NOT NULL))
);
CREATE UNIQUE INDEX preparation_assistance_reviews_one_application
  ON preparation_assistance_reviews(run_id) WHERE decision='accepted';

CREATE TABLE preparation_assistance_requests (
  request_id UUID PRIMARY KEY,
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  action TEXT NOT NULL CHECK (action IN ('source','run','review','apply')),
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER preparation_assistance_sources_immutable BEFORE UPDATE OR DELETE
  ON preparation_assistance_sources FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER preparation_assistance_suggestions_immutable BEFORE UPDATE OR DELETE
  ON preparation_assistance_suggestions FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER preparation_assistance_reviews_immutable BEFORE UPDATE OR DELETE
  ON preparation_assistance_reviews FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER preparation_assistance_requests_immutable BEFORE UPDATE OR DELETE
  ON preparation_assistance_requests FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER preparation_assistance_runs_no_delete BEFORE DELETE
  ON preparation_assistance_runs FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();

CREATE FUNCTION protect_preparation_assistance_run_inputs() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.id,OLD.contribution_id,OLD.source_id,OLD.source_version,OLD.commitment_version,
      OLD.adapter,OLD.generation,OLD.requested_by,OLD.created_at)
    IS DISTINCT FROM
     (NEW.id,NEW.contribution_id,NEW.source_id,NEW.source_version,NEW.commitment_version,
      NEW.adapter,NEW.generation,NEW.requested_by,NEW.created_at) THEN
    RAISE EXCEPTION 'preparation assistance inputs are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_assistance_runs_inputs_immutable BEFORE UPDATE
  ON preparation_assistance_runs FOR EACH ROW EXECUTE FUNCTION protect_preparation_assistance_run_inputs();
