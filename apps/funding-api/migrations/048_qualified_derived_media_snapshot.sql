-- Preserve the original source-asset pairing. Only a complete, explicitly chosen
-- single-image derived format may use a snapshot without a sponsor asset FK.
ALTER TABLE publication_deliveries DROP CONSTRAINT publication_deliveries_check1;
ALTER TABLE publication_deliveries ADD CONSTRAINT publication_delivery_media_pair CHECK (
  (media_id IS NULL AND media_snapshot IS NULL)
  OR (media_id IS NOT NULL AND media_snapshot IS NOT NULL AND COALESCE(media_snapshot->>'kind','source')='source')
  OR ((media_id IS NULL AND batch_id IS NOT NULL
    AND publication_format IN ('individual_portrait','collective_composite')
    AND jsonb_typeof(media_snapshot)='object' AND media_snapshot->>'kind'='derived'
    AND media_snapshot->>'id'=id::text AND media_snapshot->>'format'=publication_format
    AND media_snapshot->>'hash' ~ '^[a-f0-9]{64}$'
    AND media_snapshot->>'derivedHash' ~ '^[a-f0-9]{64}$'
    AND media_snapshot->>'version' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(media_snapshot->'sources')='array'
    AND jsonb_array_length(media_snapshot->'sources') BETWEEN 1 AND 10
    AND jsonb_array_length(media_snapshot->'sources')=jsonb_array_length(photo_selections)
    AND (publication_format<>'individual_portrait' OR jsonb_array_length(photo_selections)=1)) IS TRUE)
);
