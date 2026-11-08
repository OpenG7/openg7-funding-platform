-- Private associations reuse existing media and obligations. No file, consent,
-- review decision, website selection or publication is created or changed.
CREATE TABLE sponsor_media_preparation_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  obligation_id UUID NOT NULL,
  obligation_version INTEGER NOT NULL CHECK (obligation_version > 0),
  obligation_fingerprint TEXT NOT NULL CHECK (obligation_fingerprint ~ '^[a-f0-9]{64}$'),
  asset_id UUID NOT NULL,
  asset_version TEXT NOT NULL CHECK (length(asset_version) BETWEEN 1 AND 128),
  media_fingerprint TEXT NOT NULL CHECK (media_fingerprint ~ '^[a-f0-9]{64}$'),
  moderation_decision_id UUID REFERENCES moderation_decisions(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (obligation_id,asset_id),
  FOREIGN KEY (obligation_id,contribution_id) REFERENCES sponsorship_obligations(id,contribution_id),
  FOREIGN KEY (asset_id,contribution_id) REFERENCES sponsor_media_assets(id,contribution_id)
);
CREATE INDEX sponsor_media_preparation_dossier
  ON sponsor_media_preparation_assignments(contribution_id,obligation_id) WHERE active;

CREATE FUNCTION protect_sponsor_media_preparation_identity() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.id,OLD.contribution_id,OLD.obligation_id,OLD.asset_id)
    IS DISTINCT FROM (NEW.id,NEW.contribution_id,NEW.obligation_id,NEW.asset_id) THEN
    RAISE EXCEPTION 'media preparation identity is immutable' USING ERRCODE='23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER sponsor_media_preparation_identity_immutable
  BEFORE UPDATE ON sponsor_media_preparation_assignments
  FOR EACH ROW EXECUTE FUNCTION protect_sponsor_media_preparation_identity();
CREATE TRIGGER sponsor_media_preparation_no_delete
  BEFORE DELETE ON sponsor_media_preparation_assignments
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();
CREATE TRIGGER sponsor_media_preparation_workspace_changed
  AFTER INSERT OR UPDATE ON sponsor_media_preparation_assignments
  FOR EACH ROW EXECUTE FUNCTION sponsor_media_workspace_revision_changed();
