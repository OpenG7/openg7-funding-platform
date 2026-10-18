-- Private, explicitly requested media assistance; no existing media is analyzed or approved.
CREATE TABLE sponsor_media_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  asset_id UUID NOT NULL REFERENCES sponsor_media_assets(id),
  checksum TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  adapter_version TEXT NOT NULL CHECK (adapter_version ~ '^[a-z][a-z0-9_]{0,99}$'),
  generation INTEGER NOT NULL CHECK (generation > 0),
  requested_by TEXT NOT NULL CHECK (length(btrim(requested_by)) BETWEEN 1 AND 200),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','succeeded','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT CHECK (error_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  UNIQUE (asset_id,checksum,adapter_version,generation),
  UNIQUE (id,contribution_id),
  CHECK ((state='processing') = (claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((state IN ('succeeded','failed','cancelled')) = (finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX sponsor_media_analysis_active_inputs ON sponsor_media_analysis_runs(asset_id,checksum,adapter_version) WHERE state IN ('queued','processing');
CREATE INDEX sponsor_media_analysis_queue ON sponsor_media_analysis_runs(adapter_version,created_at,id) WHERE state IN ('queued','processing');
CREATE INDEX sponsor_media_analysis_dossier ON sponsor_media_analysis_runs(contribution_id,asset_id,created_at DESC,id);
CREATE TABLE sponsor_media_analysis_suggestions (
  run_id UUID PRIMARY KEY REFERENCES sponsor_media_analysis_runs(id),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sponsor_media_analysis_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL,
  run_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  decision TEXT NOT NULL CHECK (decision IN ('saved','rejected','accepted')),
  draft JSONB NOT NULL CHECK (jsonb_typeof(draft)='object'),
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (run_id,contribution_id) REFERENCES sponsor_media_analysis_runs(id,contribution_id),
  UNIQUE (run_id,version)
);
CREATE UNIQUE INDEX sponsor_media_analysis_one_acceptance ON sponsor_media_analysis_reviews(run_id) WHERE decision='accepted';
CREATE TABLE sponsor_media_analysis_requests (
  request_id UUID PRIMARY KEY,
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  action TEXT NOT NULL CHECK (action IN ('run','review')),
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER sponsor_media_analysis_suggestions_immutable BEFORE UPDATE OR DELETE ON sponsor_media_analysis_suggestions FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER sponsor_media_analysis_reviews_immutable BEFORE UPDATE OR DELETE ON sponsor_media_analysis_reviews FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER sponsor_media_analysis_requests_immutable BEFORE UPDATE OR DELETE ON sponsor_media_analysis_requests FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER sponsor_media_analysis_runs_no_delete BEFORE DELETE ON sponsor_media_analysis_runs FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE FUNCTION protect_sponsor_media_analysis_inputs() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.id,OLD.contribution_id,OLD.asset_id,OLD.checksum,OLD.adapter_version,OLD.generation,OLD.requested_by,OLD.created_at)
    IS DISTINCT FROM
    (NEW.id,NEW.contribution_id,NEW.asset_id,NEW.checksum,NEW.adapter_version,NEW.generation,NEW.requested_by,NEW.created_at) THEN
    RAISE EXCEPTION 'media analysis inputs are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sponsor_media_analysis_runs_inputs_immutable BEFORE UPDATE ON sponsor_media_analysis_runs FOR EACH ROW EXECUTE FUNCTION protect_sponsor_media_analysis_inputs();
