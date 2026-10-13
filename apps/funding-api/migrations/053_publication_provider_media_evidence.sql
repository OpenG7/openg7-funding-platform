-- Provider image identity is distinct from hashes of locally approved bytes.
-- Existing immutable evidence remains unknown; no historical URN is inferred.
ALTER TABLE sponsorship_fulfilment_evidence
  ADD COLUMN provider_media_ids JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(provider_media_ids) = 'array' AND jsonb_array_length(provider_media_ids) <= 10
    AND NOT jsonb_path_exists(provider_media_ids, '$[*] ? (@.type() != "string" || !(@ like_regex "^urn:li:image:[A-Za-z0-9_-]+$"))'));

-- Keep both legacy source assets and qualified single derived JPEGs. Only a
-- complete LinkedIn collection adds the exception for multiple derived images.
ALTER TABLE publication_deliveries DROP CONSTRAINT publication_delivery_media_pair;
ALTER TABLE publication_deliveries ADD CONSTRAINT publication_delivery_media_pair CHECK (
  (media_id IS NULL AND media_snapshot IS NULL)
  OR (media_id IS NOT NULL AND media_snapshot IS NOT NULL AND COALESCE(media_snapshot->>'kind','source')='source')
  OR ((media_id IS NULL AND batch_id IS NOT NULL
    AND publication_format IN ('individual_portrait','collective_composite','image_collection')
    AND jsonb_typeof(media_snapshot)='object' AND media_snapshot->>'kind'='derived'
    AND media_snapshot->>'id'=id::text AND media_snapshot->>'format'=publication_format
    AND media_snapshot->>'hash' ~ '^[a-f0-9]{64}$'
    AND media_snapshot->>'derivedHash' ~ '^[a-f0-9]{64}$'
    AND media_snapshot->>'version' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(media_snapshot->'sources')='array'
    AND jsonb_array_length(media_snapshot->'sources') BETWEEN 1 AND 10
    AND jsonb_array_length(media_snapshot->'sources')=jsonb_array_length(photo_selections)
    AND (publication_format<>'individual_portrait' OR jsonb_array_length(photo_selections)=1)
    AND (publication_format<>'image_collection' OR (
      split_part(feed_id,':',2)='linkedin'
      AND media_snapshot->>'transform'='ordered-jpeg-collection-v1'
      AND jsonb_array_length(photo_selections) BETWEEN 2 AND 10
      AND jsonb_typeof(media_snapshot->'images')='array'
      AND jsonb_array_length(media_snapshot->'images')=jsonb_array_length(photo_selections)
      AND NOT jsonb_path_exists(media_snapshot, '$.images[*] ? (@.type() != "object" || !exists(@.derivedHash) || @.derivedHash.type() != "string" || !(@.derivedHash like_regex "^[a-f0-9]{64}$"))')
    ))) IS TRUE)
);
