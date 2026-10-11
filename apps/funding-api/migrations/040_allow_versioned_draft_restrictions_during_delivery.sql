-- Preserve in-flight facts while allowing a reviewed restriction to be projected.
CREATE OR REPLACE FUNCTION guard_authorized_publication_draft() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.status='rejected'
    AND (to_jsonb(NEW)-ARRAY['status','updated_at']) IS NOT DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['status','updated_at'])
    AND EXISTS(SELECT 1 FROM moderation_cases c JOIN moderation_decisions d ON d.id=c.current_decision_id
      WHERE c.subject_type='publication_draft' AND c.subject_id=NEW.id
        AND c.state IN ('rejected','removed') AND d.level IN ('N3','N5')
        AND c.current_content_version=d.content_version AND c.current_fingerprint=d.content_fingerprint
        AND (NOT d.requires_independent_review OR EXISTS
          (SELECT 1 FROM moderation_independent_reviews r WHERE r.decision_id=d.id)))
    AND NOT EXISTS(SELECT 1 FROM publication_deliveries p WHERE p.batch_id=OLD.batch_id
      AND p.status IN ('approved','publishing','uncertain')
      AND p.error_code IS DISTINCT FROM 'MODERATION_RESTRICTED')
  THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM publication_deliveries WHERE batch_id=OLD.batch_id AND status IN ('approved','publishing','uncertain'))
      THEN RAISE EXCEPTION 'Revoke publication authorization before removing a draft' USING ERRCODE='55000'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM publication_deliveries WHERE batch_id=NEW.batch_id AND status IN ('approved','publishing','uncertain'))
      THEN RAISE EXCEPTION 'Revoke publication authorization before adding a draft' USING ERRCODE='55000'; END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM publication_deliveries WHERE batch_id IN (OLD.batch_id,NEW.batch_id) AND status IN ('approved','publishing','uncertain'))
      AND (NEW.batch_id IS DISTINCT FROM OLD.batch_id
        OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
        OR NEW.disclosure_text IS DISTINCT FROM OLD.disclosure_text
        OR NEW.feed_target IS DISTINCT FROM OLD.feed_target OR NEW.channel IS DISTINCT FROM OLD.channel
        OR NEW.contribution_id IS DISTINCT FROM OLD.contribution_id
        OR NEW.status NOT IN ('approved','scheduled'))
      THEN RAISE EXCEPTION 'Revoke publication authorization before changing a draft' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;
