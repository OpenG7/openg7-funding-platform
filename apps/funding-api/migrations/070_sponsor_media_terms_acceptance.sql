-- Prospective, explicit image authorization. No historical acceptance is inferred.
ALTER TABLE sponsor_media_assets ADD COLUMN original_checksum_sha256 TEXT
  CHECK(original_checksum_sha256 IS NULL OR original_checksum_sha256 ~ '^[a-f0-9]{64}$');

CREATE TABLE sponsor_media_terms_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL,
  contribution_id UUID NOT NULL,
  request_id UUID NOT NULL,
  terms_version TEXT NOT NULL CHECK(length(terms_version) BETWEEN 1 AND 100),
  terms_fingerprint TEXT NOT NULL CHECK(terms_fingerprint ~ '^[a-f0-9]{64}$'),
  terms_locale TEXT NOT NULL CHECK(terms_locale IN ('fr-CA','en')),
  terms_text TEXT NOT NULL CHECK(length(terms_text) BETWEEN 100 AND 10000),
  usage_rights JSONB NOT NULL CHECK(usage_rights->>'state'='confirmed'),
  original_checksum_sha256 TEXT NOT NULL CHECK(original_checksum_sha256 ~ '^[a-f0-9]{64}$'),
  processed_checksum_sha256 TEXT NOT NULL CHECK(processed_checksum_sha256 ~ '^[a-f0-9]{64}$'),
  actor TEXT NOT NULL CHECK(actor='sponsor-followup'),
  identity_mode TEXT NOT NULL CHECK(identity_mode='private_followup_link'),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(asset_id,contribution_id,request_id),
  UNIQUE(id,asset_id,contribution_id,request_id),
  FOREIGN KEY(asset_id,contribution_id) REFERENCES sponsor_media_assets(id,contribution_id),
  CHECK(encode(digest(terms_text,'sha256'),'hex')=terms_fingerprint)
);
CREATE TRIGGER sponsor_media_terms_acceptances_immutable BEFORE UPDATE OR DELETE ON sponsor_media_terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION moderation_preserve_evidence();

ALTER TABLE sponsor_media_usage_history ADD COLUMN terms_acceptance_id UUID;
ALTER TABLE sponsor_media_usage_history ADD CONSTRAINT sponsor_media_usage_history_acceptance
  FOREIGN KEY(terms_acceptance_id,asset_id,contribution_id,request_id)
  REFERENCES sponsor_media_terms_acceptances(id,asset_id,contribution_id,request_id);

-- A receipt remains evidence of the original command. This projection describes
-- only the latest direct authorization for the current content and current rights.
CREATE FUNCTION sponsor_media_current_usage_acceptance(asset_uuid UUID) RETURNS JSONB
LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object('id',e.id,'termsVersion',e.terms_version,
    'termsFingerprint',e.terms_fingerprint,'locale',e.terms_locale,
    'acceptedAt',to_char(e.accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'source','platform_acceptance')
  FROM sponsor_media_assets a
  JOIN LATERAL (SELECT h.* FROM sponsor_media_usage_history h WHERE h.asset_id=a.id
    ORDER BY h.recorded_at DESC,h.id DESC LIMIT 1) h ON TRUE
  JOIN sponsor_media_terms_acceptances e ON e.id=h.terms_acceptance_id
  WHERE a.id=asset_uuid AND a.deleted_at IS NULL AND a.usage_inheritance='legacy'
    AND a.usage_rights->>'state'='confirmed' AND h.usage_rights=a.usage_rights
    AND e.usage_rights=a.usage_rights
    AND e.original_checksum_sha256=a.original_checksum_sha256
    AND e.processed_checksum_sha256=a.checksum_sha256
$$;

-- Only the identity of actual new evidence enters the editorial snapshot.
-- Existing content without a platform acceptance keeps its old fingerprint.
ALTER FUNCTION moderation_snapshot(TEXT,UUID) RENAME TO moderation_snapshot_before_media_terms;
CREATE FUNCTION moderation_snapshot(subject_kind TEXT,subject_uuid UUID) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE content JSONB; acceptance JSONB;
BEGIN
  content:=moderation_snapshot_before_media_terms(subject_kind,subject_uuid);
  IF subject_kind='media' AND content IS NOT NULL THEN
    acceptance:=sponsor_media_current_usage_acceptance(subject_uuid);
    IF acceptance IS NOT NULL THEN
      content:=content||jsonb_build_object('usageAcceptanceId',acceptance->>'id');
    END IF;
  END IF;
  RETURN content;
END $$;

CREATE FUNCTION sponsor_media_terms_history_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.terms_acceptance_id IS NOT NULL OR EXISTS(
    SELECT 1 FROM sponsor_media_terms_acceptances WHERE asset_id=NEW.asset_id
  ) THEN
    PERFORM moderation_refresh_subject('media',NEW.asset_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sponsor_media_terms_history_changed AFTER INSERT ON sponsor_media_usage_history
  FOR EACH ROW EXECUTE FUNCTION sponsor_media_terms_history_changed();
