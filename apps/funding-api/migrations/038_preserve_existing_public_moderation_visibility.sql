-- An observation of already-public facts, never a new editorial decision.
CREATE TABLE moderation_legacy_visibility (
  subject_type TEXT NOT NULL CHECK(subject_type IN ('sponsorship','media')),
  subject_id UUID NOT NULL,
  content_fingerprint TEXT NOT NULL CHECK(content_fingerprint ~ '^[a-f0-9]{64}$'),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'legacy_public_visibility' CHECK(source='legacy_public_visibility'),
  invalidated_at TIMESTAMPTZ,
  PRIMARY KEY(subject_type,subject_id)
);
INSERT INTO moderation_legacy_visibility(subject_type,subject_id,content_fingerprint)
SELECT 'sponsorship',c.id,encode(digest(moderation_snapshot('sponsorship',c.id)::text,'sha256'),'hex')
FROM fund_contributions c WHERE c.contribution_type='sponsorship_interest' AND c.status IN ('paid','refunded','disputed')
  AND c.public_display_consent IS TRUE AND c.sponsor_review_status='approved'
  AND COALESCE(c.sponsor_site_visibility_held,FALSE) IS FALSE
  AND NOT EXISTS(SELECT 1 FROM moderation_cases mc WHERE mc.subject_type='sponsorship' AND mc.subject_id=c.id AND mc.current_decision_id IS NOT NULL);
INSERT INTO moderation_legacy_visibility(subject_type,subject_id,content_fingerprint)
SELECT 'media',m.id,encode(digest(moderation_snapshot('media',m.id)::text,'sha256'),'hex')
FROM sponsor_media_assets m JOIN moderation_legacy_visibility c ON c.subject_type='sponsorship' AND c.subject_id=m.contribution_id
WHERE m.review_status='approved' AND m.deleted_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM moderation_cases mc WHERE mc.subject_type='media' AND mc.subject_id=m.id AND mc.current_decision_id IS NOT NULL);
CREATE FUNCTION moderation_invalidate_legacy_visibility() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE subject_kind TEXT; subject_uuid UUID; new_data JSONB;
BEGIN
  subject_kind:=CASE TG_TABLE_NAME WHEN 'fund_contributions' THEN 'sponsorship' ELSE 'media' END;
  IF TG_OP='DELETE' THEN subject_uuid:=OLD.id; ELSE subject_uuid:=NEW.id; END IF;
  IF TG_OP<>'DELETE' THEN new_data:=to_jsonb(NEW); END IF;
  UPDATE moderation_legacy_visibility SET invalidated_at=NOW() WHERE subject_type=subject_kind AND subject_id=subject_uuid
    AND invalidated_at IS NULL AND (TG_OP='DELETE' OR content_fingerprint IS DISTINCT FROM
      encode(digest(moderation_snapshot(subject_kind,subject_uuid)::text,'sha256'),'hex')
      OR (subject_kind='sponsorship' AND (COALESCE((new_data->>'public_display_consent')::boolean,FALSE) IS FALSE OR new_data->>'sponsor_review_status' IS DISTINCT FROM 'approved' OR COALESCE((new_data->>'sponsor_site_visibility_held')::boolean,FALSE)))
      OR (subject_kind='media' AND (new_data->>'review_status' IS DISTINCT FROM 'approved' OR new_data->>'deleted_at' IS NOT NULL)));
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER moderation_legacy_sponsor_changed AFTER UPDATE OR DELETE ON fund_contributions FOR EACH ROW EXECUTE FUNCTION moderation_invalidate_legacy_visibility();
CREATE TRIGGER moderation_legacy_media_changed AFTER UPDATE OR DELETE ON sponsor_media_assets FOR EACH ROW EXECUTE FUNCTION moderation_invalidate_legacy_visibility();
