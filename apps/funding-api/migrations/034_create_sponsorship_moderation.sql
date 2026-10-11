-- No historical approval, acceptance, external send or deletion is inferred.
CREATE TABLE moderation_policies (
  version TEXT PRIMARY KEY,
  policy_fingerprint TEXT NOT NULL CHECK (policy_fingerprint ~ '^[a-f0-9]{64}$'),
  editorial_status TEXT NOT NULL CHECK (editorial_status IN ('approved','withdrawn')),
  public_active BOOLEAN NOT NULL DEFAULT FALSE,
  public_charter_hash TEXT CHECK (public_charter_hash ~ '^[a-f0-9]{64}$'),
  public_validated_at TIMESTAMPTZ,
  effective_at TIMESTAMPTZ,
  CHECK (NOT public_active OR (public_charter_hash IS NOT NULL AND public_validated_at IS NOT NULL AND effective_at IS NOT NULL))
);
INSERT INTO moderation_policies(version,policy_fingerprint,editorial_status)
VALUES('1.0','f4f2d3a93966821c75eabf3e53f1830d87b79bdc9a71bcbb32b8696b9b4b893f','approved');

CREATE TABLE moderation_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('sponsorship','media','publication_draft','publication_delivery')),
  subject_id UUID NOT NULL,
  contribution_id UUID REFERENCES fund_contributions(id),
  current_content_version INTEGER NOT NULL DEFAULT 0 CHECK (current_content_version >= 0),
  current_fingerprint TEXT CHECK (current_fingerprint ~ '^[a-f0-9]{64}$'),
  current_decision_id UUID,
  state TEXT NOT NULL DEFAULT 'unreviewed' CHECK (state IN ('unreviewed','approved','correction_requested','on_hold','rejected','removed','pending_independent_review')),
  assigned_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subject_type,subject_id)
);
CREATE TABLE moderation_content_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  content_version INTEGER NOT NULL CHECK (content_version > 0),
  content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  contribution_id UUID REFERENCES fund_contributions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(subject_type,subject_id) REFERENCES moderation_cases(subject_type,subject_id),
  UNIQUE(subject_type,subject_id,content_version)
);
CREATE TABLE moderation_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES moderation_cases(id),
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  contribution_id UUID REFERENCES fund_contributions(id),
  content_version INTEGER NOT NULL,
  content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  policy_version TEXT NOT NULL REFERENCES moderation_policies(version),
  level TEXT NOT NULL CHECK (level IN ('N0','N1','N2','N3','N4','N5')),
  primary_reason TEXT CHECK (primary_reason IN ('HATE_TARGETED','DEHUMANIZATION','DISCRIMINATION','TARGETED_HARASSMENT','THREAT','VIOLENCE_INCITEMENT','VIOLENCE_GLORIFICATION','EXPLOITATION','SEXUAL_CONTENT','PRIVACY_VIOLATION','FRAUD_IMPERSONATION','MISLEADING_CLAIM','ELECTORAL_ADVERTISING','ILLEGAL_CONTENT','IP_RIGHTS','EXTERNAL_LINK_RISK','EDITORIAL_INCOMPATIBILITY')),
  secondary_reasons TEXT[] NOT NULL DEFAULT '{}',
  editorial_provision TEXT,
  internal_reason TEXT CHECK (length(internal_reason) <= 2000),
  sponsor_explanation TEXT CHECK (length(sponsor_explanation) <= 2000),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 200),
  requires_independent_review BOOLEAN NOT NULL,
  previous_decision_id UUID REFERENCES moderation_decisions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(subject_type,subject_id,content_version) REFERENCES moderation_content_versions(subject_type,subject_id,content_version),
  CHECK ((level='N0' AND primary_reason IS NULL) OR (level<>'N0' AND primary_reason IS NOT NULL AND length(btrim(internal_reason)) > 0 AND length(btrim(sponsor_explanation)) > 0)),
  CHECK (level <> 'N4' OR subject_type='sponsorship'),
  CHECK (level <> 'N3' OR subject_type<>'sponsorship')
);
ALTER TABLE moderation_cases ADD CONSTRAINT moderation_case_current_decision FOREIGN KEY(current_decision_id) REFERENCES moderation_decisions(id);
CREATE TABLE moderation_independent_reviews (
  decision_id UUID PRIMARY KEY REFERENCES moderation_decisions(id),
  reviewer TEXT NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE moderation_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES moderation_decisions(id),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  message TEXT NOT NULL CHECK (length(btrim(message)) BETWEEN 10 AND 2000),
  requester TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
  reviewer TEXT,
  resulting_decision_id UUID REFERENCES moderation_decisions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (state <> 'resolved' OR (reviewer IS NOT NULL AND resulting_decision_id IS NOT NULL))
);
CREATE UNIQUE INDEX moderation_appeal_open ON moderation_appeals(decision_id) WHERE state='open';
CREATE INDEX moderation_case_open ON moderation_cases(state,updated_at) WHERE state<>'approved';
CREATE INDEX moderation_case_sponsor ON moderation_cases(contribution_id,updated_at);
CREATE INDEX moderation_decision_subject ON moderation_decisions(subject_type,subject_id,created_at);

-- Claims, payments and approval statuses are intentionally absent from snapshots.
CREATE FUNCTION moderation_snapshot(subject_kind TEXT, subject_uuid UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE result JSONB;
BEGIN
  IF subject_kind='sponsorship' THEN
    SELECT jsonb_build_object('companyName',c.sponsor_company_name,'website',c.sponsor_website_url,
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

-- Preserve each actual edit, including a return to an older identical text.
CREATE FUNCTION moderation_refresh_subject(subject_kind TEXT, subject_uuid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE review_case moderation_cases%ROWTYPE; content JSONB; fingerprint TEXT; revision INTEGER;
BEGIN
  SELECT * INTO review_case FROM moderation_cases WHERE subject_type=subject_kind AND subject_id=subject_uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  content:=moderation_snapshot(subject_kind,subject_uuid);
  fingerprint:=encode(digest(content::text,'sha256'),'hex');
  revision:=review_case.current_content_version+1;
  IF content IS NOT NULL THEN
    INSERT INTO moderation_content_versions(subject_type,subject_id,content_version,content_fingerprint,snapshot,contribution_id)
      VALUES(subject_kind,subject_uuid,revision,fingerprint,content,review_case.contribution_id);
  END IF;
  UPDATE moderation_cases SET state='unreviewed',current_fingerprint=fingerprint,current_content_version=revision,updated_at=NOW()
    WHERE id=review_case.id;
END $$;

CREATE FUNCTION moderation_invalidate_content() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE subject_kind TEXT; subject_uuid UUID; old_data JSONB; new_data JSONB; changed BOOLEAN;
BEGIN
  subject_kind := CASE TG_TABLE_NAME WHEN 'fund_contributions' THEN 'sponsorship'
    WHEN 'sponsor_media_assets' THEN 'media' WHEN 'sponsor_publication_drafts' THEN 'publication_draft'
    ELSE 'publication_delivery' END;
  IF TG_OP='DELETE' THEN subject_uuid:=OLD.id; ELSE subject_uuid:=NEW.id; END IF;
  IF TG_OP='UPDATE' THEN
    old_data:=to_jsonb(OLD); new_data:=to_jsonb(NEW);
    IF subject_kind='sponsorship' THEN
      changed := (old_data->'sponsor_company_name',old_data->'sponsor_website_url',old_data->'sponsor_logo_url',old_data->'sponsor_message',old_data->'sponsor_public_summary',old_data->'sponsor_public_slug')
        IS DISTINCT FROM (new_data->'sponsor_company_name',new_data->'sponsor_website_url',new_data->'sponsor_logo_url',new_data->'sponsor_message',new_data->'sponsor_public_summary',new_data->'sponsor_public_slug');
    ELSIF subject_kind='media' THEN
      changed := (old_data->'contribution_id',old_data->'kind',old_data->'checksum_sha256',old_data->'processed_storage_key',old_data->'original_storage_key',old_data->'alt_text',old_data->'width',old_data->'height',old_data->'deleted_at')
        IS DISTINCT FROM (new_data->'contribution_id',new_data->'kind',new_data->'checksum_sha256',new_data->'processed_storage_key',new_data->'original_storage_key',new_data->'alt_text',new_data->'width',new_data->'height',new_data->'deleted_at');
    ELSIF subject_kind='publication_draft' THEN
      changed := (old_data->'contribution_id',old_data->'batch_id',old_data->'feed_target',old_data->'channel',old_data->'title',old_data->'body',old_data->'disclosure_text')
        IS DISTINCT FROM (new_data->'contribution_id',new_data->'batch_id',new_data->'feed_target',new_data->'channel',new_data->'title',new_data->'body',new_data->'disclosure_text');
    ELSE
      changed := (old_data->'feed_id',old_data->'message',old_data->'account_id',old_data->'mode',old_data->'media_id',old_data->'batch_id')
        IS DISTINCT FROM (new_data->'feed_id',new_data->'message',new_data->'account_id',new_data->'mode',new_data->'media_id',new_data->'batch_id');
    END IF;
    IF NOT changed THEN RETURN NEW; END IF;
  END IF;
  PERFORM moderation_refresh_subject(subject_kind,subject_uuid);
  IF subject_kind='sponsorship' THEN
    PERFORM moderation_refresh_subject(subject_type,subject_id) FROM moderation_cases
      WHERE (subject_type='publication_draft' AND subject_id IN (SELECT id FROM sponsor_publication_drafts WHERE contribution_id=subject_uuid))
        OR (subject_type='publication_delivery' AND subject_id IN (SELECT p.id FROM publication_deliveries p JOIN sponsor_publication_drafts d ON d.batch_id=p.batch_id WHERE d.contribution_id=subject_uuid))
      ORDER BY subject_type,subject_id;
  ELSIF subject_kind='media' THEN
    PERFORM moderation_refresh_subject(subject_type,subject_id) FROM moderation_cases
      WHERE subject_type='publication_delivery' AND subject_id IN (SELECT id FROM publication_deliveries WHERE media_id=subject_uuid) ORDER BY subject_id;
  ELSIF subject_kind='publication_draft' THEN
    PERFORM moderation_refresh_subject(subject_type,subject_id) FROM moderation_cases
      WHERE subject_type='publication_delivery' AND subject_id IN (SELECT id FROM publication_deliveries
        WHERE batch_id IN (CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.batch_id END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.batch_id END)) ORDER BY subject_id;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER moderation_sponsor_changed AFTER UPDATE ON fund_contributions FOR EACH ROW EXECUTE FUNCTION moderation_invalidate_content();
CREATE TRIGGER moderation_media_changed AFTER UPDATE OR DELETE ON sponsor_media_assets FOR EACH ROW EXECUTE FUNCTION moderation_invalidate_content();
CREATE TRIGGER moderation_draft_changed AFTER INSERT OR UPDATE OR DELETE ON sponsor_publication_drafts FOR EACH ROW EXECUTE FUNCTION moderation_invalidate_content();
CREATE TRIGGER moderation_delivery_changed AFTER UPDATE ON publication_deliveries FOR EACH ROW EXECUTE FUNCTION moderation_invalidate_content();

CREATE FUNCTION moderation_preserve_evidence() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Moderation evidence is immutable; append a new decision' USING ERRCODE='55000'; END $$;
CREATE TRIGGER moderation_decision_immutable BEFORE UPDATE OR DELETE ON moderation_decisions FOR EACH ROW EXECUTE FUNCTION moderation_preserve_evidence();
CREATE TRIGGER moderation_content_immutable BEFORE UPDATE OR DELETE ON moderation_content_versions FOR EACH ROW EXECUTE FUNCTION moderation_preserve_evidence();
CREATE TRIGGER moderation_review_immutable BEFORE UPDATE OR DELETE ON moderation_independent_reviews FOR EACH ROW EXECUTE FUNCTION moderation_preserve_evidence();
