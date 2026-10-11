-- Extend the initial schema additively; published sponsor names are reviewed too.
CREATE OR REPLACE FUNCTION moderation_snapshot(subject_kind TEXT, subject_uuid UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE result JSONB;
BEGIN
  IF subject_kind='sponsorship' THEN
    SELECT jsonb_build_object('companyName',c.sponsor_company_name,'publicName',c.public_name,'website',c.sponsor_website_url,
      'logoUrl',c.sponsor_logo_url,'message',c.sponsor_message,'publicSummary',c.sponsor_public_summary,
      'publicSlug',c.sponsor_public_slug)
    INTO result FROM fund_contributions c WHERE c.id=subject_uuid AND c.contribution_type='sponsorship_interest';
  ELSIF subject_kind='media' THEN
    SELECT jsonb_build_object('contributionId',m.contribution_id,'kind',m.kind,
      'checksum',m.checksum_sha256,'storageKey',m.processed_storage_key,'originalStorageKey',m.original_storage_key,
      'altText',m.alt_text,'width',m.width,'height',m.height,'deletedAt',m.deleted_at)
    INTO result FROM sponsor_media_assets m WHERE m.id=subject_uuid;
  ELSIF subject_kind='publication_draft' THEN
    SELECT jsonb_build_object('contributionId',d.contribution_id,'feedTarget',d.feed_target,
      'channel',d.channel,'title',d.title,'body',d.body,'disclosure',d.disclosure_text,
      'sponsor',moderation_snapshot('sponsorship',d.contribution_id))
    INTO result FROM sponsor_publication_drafts d WHERE d.id=subject_uuid;
  ELSIF subject_kind='publication_delivery' THEN
    SELECT jsonb_build_object('feedId',d.feed_id,'message',d.message,'accountId',d.account_id,'mode',d.mode,
      'media',CASE WHEN d.media_id IS NULL THEN NULL ELSE moderation_snapshot('media',d.media_id) END,
      'sources',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'contributionId',s.contribution_id,
        'content',moderation_snapshot('publication_draft',s.id)) ORDER BY s.id)
        FROM sponsor_publication_drafts s WHERE s.batch_id=d.batch_id),'[]'::jsonb))
    INTO result FROM publication_deliveries d WHERE d.id=subject_uuid;
  END IF;
  RETURN result;
END $$;
CREATE FUNCTION moderation_public_name_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_name IS DISTINCT FROM OLD.public_name THEN
    PERFORM moderation_refresh_subject('sponsorship',NEW.id);
    PERFORM moderation_refresh_subject(subject_type,subject_id) FROM moderation_cases
      WHERE (subject_type='publication_draft' AND subject_id IN (SELECT id FROM sponsor_publication_drafts WHERE contribution_id=NEW.id))
        OR (subject_type='publication_delivery' AND subject_id IN (SELECT p.id FROM publication_deliveries p JOIN sponsor_publication_drafts d ON d.batch_id=p.batch_id WHERE d.contribution_id=NEW.id))
      ORDER BY subject_type,subject_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_public_name_changed AFTER UPDATE OF public_name ON fund_contributions FOR EACH ROW EXECUTE FUNCTION moderation_public_name_changed();
ALTER TABLE moderation_decisions ADD CONSTRAINT moderation_secondary_reason_codes CHECK (
  secondary_reasons <@ ARRAY['HATE_TARGETED','DEHUMANIZATION','DISCRIMINATION','TARGETED_HARASSMENT','THREAT','VIOLENCE_INCITEMENT','VIOLENCE_GLORIFICATION','EXPLOITATION','SEXUAL_CONTENT','PRIVACY_VIOLATION','FRAUD_IMPERSONATION','MISLEADING_CLAIM','ELECTORAL_ADVERTISING','ILLEGAL_CONTENT','IP_RIGHTS','EXTERNAL_LINK_RISK','EDITORIAL_INCOMPATIBILITY']::TEXT[]
  AND NOT COALESCE(primary_reason=ANY(secondary_reasons),FALSE));
ALTER TABLE moderation_decisions ADD CONSTRAINT moderation_editorial_provision_required CHECK (
  NOT (primary_reason='EDITORIAL_INCOMPATIBILITY' OR 'EDITORIAL_INCOMPATIBILITY'=ANY(secondary_reasons))
  OR (editorial_provision IS NOT NULL AND editorial_provision IN ('recognition-scope','nonpartisan-recognition','public-safety-and-rights')));
ALTER TABLE moderation_decisions ADD CONSTRAINT moderation_grave_independence_required CHECK (level<>'N4' OR requires_independent_review);

-- Existing reviews of public_name do not acquire an inferred approval.
SELECT moderation_refresh_subject(subject_type,subject_id) FROM moderation_cases
  WHERE current_fingerprint IS DISTINCT FROM encode(digest(moderation_snapshot(subject_type,subject_id)::text,'sha256'),'hex') ORDER BY subject_type,subject_id;
