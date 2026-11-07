-- Explicit evidence of a received agreement. No historical Checkout fact is rewritten.
-- Applying this migration neither grants consent nor publishes or sends anything.
CREATE TABLE admin_sponsorship_consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  request_id UUID NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  expected_version TEXT NOT NULL CHECK (length(expected_version) BETWEEN 1 AND 128),
  scope TEXT NOT NULL CHECK (scope='public_profile_name_and_presentation'),
  agreement_received BOOLEAN NOT NULL CHECK (agreement_received),
  agreed_on DATE NOT NULL,
  evidence_reference TEXT NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 1000),
  previous_consent BOOLEAN NOT NULL,
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  audit_reference UUID NOT NULL REFERENCES admin_audit_log(id),
  receipt JSONB NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (agreed_on <= (recorded_at AT TIME ZONE 'America/Toronto')::date)
);
CREATE INDEX admin_sponsorship_consent_history
  ON admin_sponsorship_consent_records(contribution_id,recorded_at DESC,id DESC);
CREATE TRIGGER admin_sponsorship_consent_records_immutable
  BEFORE UPDATE OR DELETE ON admin_sponsorship_consent_records
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_commitment_history();

-- Keep every pre-existing fingerprint byte-identical when no new record exists.
-- Only the identity of the new evidence is part of the editorial snapshot.
ALTER FUNCTION moderation_snapshot(TEXT,UUID) RENAME TO moderation_snapshot_before_documented_consent;
CREATE FUNCTION moderation_snapshot(subject_kind TEXT,subject_uuid UUID) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE content JSONB; consent_record UUID;
BEGIN
  content:=moderation_snapshot_before_documented_consent(subject_kind,subject_uuid);
  IF subject_kind='sponsorship' AND content IS NOT NULL THEN
    SELECT id INTO consent_record FROM admin_sponsorship_consent_records
      WHERE contribution_id=subject_uuid ORDER BY recorded_at DESC,id DESC LIMIT 1;
    IF consent_record IS NOT NULL THEN
      content:=content || jsonb_build_object('documentedConsentRecordId',consent_record);
    END IF;
  END IF;
  RETURN content;
END $$;

-- Reuse the native review invalidation. This creates no approval or remote command.
CREATE FUNCTION sponsorship_documented_consent_changed() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM moderation_refresh_subject('sponsorship',NEW.contribution_id);
  PERFORM moderation_refresh_subject(subject_type,subject_id) FROM moderation_cases
    WHERE (subject_type='publication_draft' AND subject_id IN
      (SELECT id FROM sponsor_publication_drafts WHERE contribution_id=NEW.contribution_id))
    OR (subject_type='publication_delivery' AND subject_id IN (
      SELECT p.id FROM publication_deliveries p WHERE p.batch_id IN
        (SELECT batch_id FROM sponsor_publication_drafts WHERE contribution_id=NEW.contribution_id)
      OR p.media_id IN (SELECT id FROM sponsor_media_assets WHERE contribution_id=NEW.contribution_id)
      OR EXISTS(SELECT 1 FROM publication_delivery_photos photo JOIN sponsor_media_assets asset
        ON asset.id=photo.asset_id WHERE photo.delivery_id=p.id AND photo.active
          AND asset.contribution_id=NEW.contribution_id)))
    ORDER BY subject_type,subject_id;
  RETURN NEW;
END $$;
CREATE TRIGGER sponsorship_documented_consent_changed AFTER INSERT ON admin_sponsorship_consent_records
  FOR EACH ROW EXECUTE FUNCTION sponsorship_documented_consent_changed();
