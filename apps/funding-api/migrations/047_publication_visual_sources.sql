-- A visual format is an explicit prepared choice, separate from the immutable offer.
ALTER TABLE publication_deliveries ADD COLUMN publication_format TEXT NOT NULL DEFAULT 'collective_text'
  CHECK(publication_format IN ('collective_text','individual_portrait','collective_composite','image_collection'));
ALTER TABLE publication_deliveries ADD COLUMN photo_selections JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK(jsonb_typeof(photo_selections)='array');
CREATE TABLE publication_delivery_photos (
  delivery_id UUID NOT NULL REFERENCES publication_deliveries(id) ON DELETE CASCADE,
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  asset_id UUID NOT NULL,
  asset_version TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(delivery_id,contribution_id),
  UNIQUE(delivery_id,asset_id),
  FOREIGN KEY(asset_id,contribution_id) REFERENCES sponsor_media_assets(id,contribution_id)
);

ALTER FUNCTION moderation_snapshot(TEXT,UUID) RENAME TO moderation_snapshot_before_visual_sources;
CREATE FUNCTION moderation_snapshot(subject_kind TEXT,subject_uuid UUID) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE content JSONB; visual JSONB;
BEGIN
  content:=moderation_snapshot_before_visual_sources(subject_kind,subject_uuid);
  IF subject_kind='publication_delivery' AND content IS NOT NULL THEN
    SELECT jsonb_build_object('format',p.publication_format,'photoSelections',p.photo_selections,'derivedMedia',p.media_snapshot,
      'photoSources',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'contributionId',m.contribution_id,
        'version',m.updated_at::text,'usage',m.usage_rights,'reviewStatus',m.review_status,'deletedAt',m.deleted_at,
        'checksum',m.checksum_sha256) ORDER BY r.contribution_id)
        FROM publication_delivery_photos r JOIN sponsor_media_assets m ON m.id=r.asset_id
        WHERE r.delivery_id=p.id AND r.active),'[]'::jsonb))
      INTO visual FROM publication_deliveries p WHERE p.id=subject_uuid;
    content:=content||jsonb_build_object('visual',visual);
  END IF;
  RETURN content;
END $$;
CREATE FUNCTION moderation_visual_source_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM moderation_refresh_subject('publication_delivery',delivery_id)
    FROM publication_delivery_photos WHERE asset_id=NEW.id AND active ORDER BY delivery_id;
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_visual_source_changed AFTER UPDATE ON sponsor_media_assets
  FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION moderation_visual_source_changed();
CREATE FUNCTION moderation_visual_selection_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM moderation_refresh_subject('publication_delivery',NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_visual_selection_changed AFTER UPDATE OF publication_format,photo_selections,media_snapshot ON publication_deliveries
  FOR EACH ROW WHEN (OLD.publication_format IS DISTINCT FROM NEW.publication_format
    OR OLD.photo_selections IS DISTINCT FROM NEW.photo_selections OR OLD.media_snapshot IS DISTINCT FROM NEW.media_snapshot)
  EXECUTE FUNCTION moderation_visual_selection_changed();
CREATE FUNCTION moderation_visual_dependencies_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM moderation_refresh_subject('publication_delivery',NEW.delivery_id);
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_visual_dependencies_changed AFTER INSERT OR UPDATE ON publication_delivery_photos
  FOR EACH ROW EXECUTE FUNCTION moderation_visual_dependencies_changed();
DO $$ DECLARE item RECORD;
BEGIN
  FOR item IN SELECT p.id FROM publication_deliveries p JOIN moderation_cases mc
    ON mc.subject_type='publication_delivery' AND mc.subject_id=p.id
    WHERE mc.current_decision_id IS NOT NULL AND p.status NOT IN ('published','cancelled','rejected') ORDER BY p.id LOOP
    PERFORM moderation_refresh_subject('publication_delivery',item.id);
  END LOOP;
END $$;
