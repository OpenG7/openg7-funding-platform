-- Reviewers need the prepared facts and hashes, never object storage keys.
CREATE FUNCTION moderation_visual_media_facts(media JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN media IS NULL OR media='null'::jsonb THEN NULL ELSE
    jsonb_build_object('kind',media->'kind','id',media->'id','alt',media->'alt',
      'hash',media->'hash','derivedHash',media->'derivedHash','version',media->'version',
      'usage',media->'usage','transform',media->'transform','format',media->'format',
      'restrictionsReviewed',media->'restrictionsReviewed',
      'url',CASE WHEN media->>'kind' IS DISTINCT FROM 'derived' AND media->>'id' ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        THEN '/api/public/sponsor-media/' || (media->>'id') ELSE NULL END,
      'sources',CASE WHEN jsonb_typeof(media->'sources')='array' THEN
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('contributionId',source->'contributionId','name',source->'name',
          'media',moderation_visual_media_facts(source->'media')) ORDER BY source->>'contributionId'),'[]'::jsonb)
          FROM jsonb_array_elements(media->'sources') source) ELSE NULL END)
  END
$$;
ALTER FUNCTION moderation_snapshot(TEXT,UUID) RENAME TO moderation_snapshot_before_private_visual_projection;
CREATE FUNCTION moderation_snapshot(subject_kind TEXT,subject_uuid UUID) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE content JSONB; prepared JSONB;
BEGIN
  content:=moderation_snapshot_before_private_visual_projection(subject_kind,subject_uuid);
  IF content IS NULL THEN RETURN NULL; END IF;
  IF subject_kind='media' THEN
    content:=content-'storageKey'-'originalStorageKey';
  ELSIF subject_kind='publication_delivery' THEN
    SELECT moderation_visual_media_facts(media_snapshot) INTO prepared FROM publication_deliveries WHERE id=subject_uuid;
    content:=jsonb_set(content,'{visual,derivedMedia}',COALESCE(prepared,'null'::jsonb));
  END IF;
  RETURN content;
END $$;
-- Append a new review version; immutable prior snapshots and decisions survive.
DO $$ DECLARE item RECORD;
BEGIN
  FOR item IN SELECT subject_type,subject_id FROM moderation_cases
    WHERE subject_type IN ('media','publication_delivery') AND current_decision_id IS NOT NULL
    ORDER BY subject_type,subject_id LOOP
    PERFORM moderation_refresh_subject(item.subject_type,item.subject_id);
  END LOOP;
END $$;
