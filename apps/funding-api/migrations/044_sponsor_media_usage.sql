-- Historical assets have no inferred license. New uses require confirmed facts.
ALTER TABLE sponsor_media_assets ADD COLUMN usage_rights JSONB NOT NULL DEFAULT
  '{"state":"needs_confirmation","channels":[],"targets":[],"transformations":[],"credit":null,"restrictions":null}'::jsonb
  CHECK (jsonb_typeof(usage_rights)='object'
    AND usage_rights->>'state' IN ('needs_confirmation','confirmed','withdrawn')
    AND jsonb_typeof(usage_rights->'channels')='array'
    AND jsonb_typeof(usage_rights->'targets')='array'
    AND jsonb_typeof(usage_rights->'transformations')='array');
ALTER TABLE sponsor_media_assets ADD COLUMN usage_restrictions_reviewed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sponsor_media_assets ADD CONSTRAINT sponsor_media_asset_contribution_pair UNIQUE(id,contribution_id);

CREATE TABLE sponsor_media_preferences (
  contribution_id UUID PRIMARY KEY REFERENCES fund_contributions(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  preferred_asset_id UUID,
  correction TEXT CHECK(correction IS NULL OR length(correction) BETWEEN 10 AND 1000),
  state TEXT NOT NULL CHECK(state IN ('pending','accepted','rejected')),
  sponsor_explanation TEXT CHECK(sponsor_explanation IS NULL OR length(sponsor_explanation) BETWEEN 10 AND 1000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(preferred_asset_id,contribution_id) REFERENCES sponsor_media_assets(id,contribution_id),
  CHECK(state='pending' OR sponsor_explanation IS NOT NULL)
);

CREATE TABLE sponsor_media_usage_commands (
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  request_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('usage','preference','preference_review')),
  payload_fingerprint TEXT NOT NULL CHECK(payload_fingerprint ~ '^[a-f0-9]{64}$'),
  result JSONB NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(contribution_id,request_id)
);

CREATE TABLE sponsor_media_usage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES sponsor_media_assets(id),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  request_id UUID NOT NULL,
  usage_rights JSONB NOT NULL,
  evidence_reference TEXT,
  actor TEXT NOT NULL,
  FOREIGN KEY(asset_id,contribution_id) REFERENCES sponsor_media_assets(id,contribution_id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(contribution_id,request_id) REFERENCES sponsor_media_usage_commands(contribution_id,request_id)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_sponsor_media_usage_history_asset ON sponsor_media_usage_history(asset_id,recorded_at,id);
CREATE TRIGGER sponsor_media_usage_history_immutable BEFORE UPDATE OR DELETE ON sponsor_media_usage_history
  FOR EACH ROW EXECUTE FUNCTION moderation_preserve_evidence();
CREATE TRIGGER sponsor_media_usage_commands_immutable BEFORE UPDATE OR DELETE ON sponsor_media_usage_commands
  FOR EACH ROW EXECUTE FUNCTION moderation_preserve_evidence();

-- Wrap the effective snapshot; never rewrite an already applied migration or evidence row.
ALTER FUNCTION moderation_snapshot(TEXT,UUID) RENAME TO moderation_snapshot_before_media_usage;
CREATE FUNCTION moderation_snapshot(subject_kind TEXT,subject_uuid UUID) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE content JSONB; usage JSONB; prepared_media JSONB;
BEGIN
  content:=moderation_snapshot_before_media_usage(subject_kind,subject_uuid);
  IF subject_kind='media' AND content IS NOT NULL THEN
    SELECT usage_rights INTO usage FROM sponsor_media_assets WHERE id=subject_uuid;
    content:=content||jsonb_build_object('usage',usage);
  ELSIF subject_kind='publication_delivery' AND content IS NOT NULL THEN
    SELECT CASE WHEN media_snapshot IS NULL THEN NULL ELSE jsonb_build_object(
      'id',media_snapshot->'id','sourceHash',media_snapshot->'hash','derivedHash',media_snapshot->'derivedHash',
      'version',media_snapshot->'version','usage',media_snapshot->'usage','transform',media_snapshot->'transform') END
      INTO prepared_media FROM publication_deliveries WHERE id=subject_uuid;
    content:=content||jsonb_build_object('preparedMedia',prepared_media);
  END IF;
  RETURN content;
END $$;

CREATE FUNCTION moderation_media_usage_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM moderation_refresh_subject('media',NEW.id);
  PERFORM moderation_refresh_subject(subject_type,subject_id) FROM moderation_cases
    WHERE subject_type='publication_delivery'
      AND subject_id IN (SELECT id FROM publication_deliveries WHERE media_id=NEW.id)
    ORDER BY subject_id;
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_media_usage_changed AFTER UPDATE OF usage_rights ON sponsor_media_assets
  FOR EACH ROW WHEN (OLD.usage_rights IS DISTINCT FROM NEW.usage_rights)
  EXECUTE FUNCTION moderation_media_usage_changed();

CREATE FUNCTION moderation_prepared_media_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM moderation_refresh_subject('publication_delivery',NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_prepared_media_changed AFTER UPDATE OF media_snapshot ON publication_deliveries
  FOR EACH ROW WHEN (OLD.media_snapshot IS DISTINCT FROM NEW.media_snapshot)
  EXECUTE FUNCTION moderation_prepared_media_changed();

-- Old approval panels and deliveries cannot authorize a use without the new facts.
DO $$ DECLARE item RECORD;
BEGIN
  FOR item IN SELECT subject_id FROM moderation_cases WHERE subject_type='media' ORDER BY subject_id LOOP
    PERFORM moderation_refresh_subject('media',item.subject_id);
  END LOOP;
  FOR item IN SELECT subject_id FROM moderation_cases WHERE subject_type='publication_delivery'
    AND subject_id IN (SELECT id FROM publication_deliveries WHERE media_id IS NOT NULL) ORDER BY subject_id LOOP
    PERFORM moderation_refresh_subject('publication_delivery',item.subject_id);
  END LOOP;
END $$;
