/** Inspect delivery-time snapshots exclusively. Current media rights or visibility
 * cannot invalidate what was recorded earlier. Incomplete metadata is unknown. */
const projectionSql = (scope: string): string => `
WITH evidence AS MATERIALIZED (
  SELECT e.*,ob.benefit_id,benefit.value AS benefit,
    duration.fulfilment_evidence_id IS NOT NULL AS duration_verified,
    (SELECT jsonb_agg(source) FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(e.source_snapshot)='array' THEN e.source_snapshot ELSE '[]'::jsonb END
    ) source WHERE COALESCE(source->>'contribution_id',source->>'contributionId',source->>'id')=e.contribution_id::text) AS own_sources
  FROM sponsorship_fulfilment_evidence e
  JOIN sponsorship_obligations ob ON ob.id=e.obligation_id AND ob.state='fulfilled' AND ob.fulfilment_evidence_id=e.id
  JOIN sponsorship_commitments commitment ON commitment.id=ob.commitment_id
  LEFT JOIN sponsorship_offers offer ON offer.id=commitment.offer_id
  LEFT JOIN LATERAL (
    SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(offer.snapshot->'benefits')='array'
      THEN offer.snapshot->'benefits' ELSE '[]'::jsonb END) value WHERE value->>'id'=ob.benefit_id LIMIT 1
  ) benefit ON TRUE
  LEFT JOIN sponsorship_obligation_duration_attestations duration ON duration.obligation_id=ob.id AND duration.fulfilment_evidence_id=e.id
  WHERE e.recorded_at<=$1::timestamptz ${scope}
), sources AS (
  SELECT evidence.*,
    CASE WHEN jsonb_array_length(COALESCE(own_sources,'[]'::jsonb))=1 THEN own_sources->0 ELSE NULL END AS own_source,
    CASE WHEN channel='website' AND jsonb_typeof(media_snapshot)='array' THEN media_snapshot
      WHEN channel<>'website' AND media_snapshot->>'kind'='derived' AND jsonb_typeof(media_snapshot->'sources')='array'
        THEN COALESCE((SELECT jsonb_agg((participant->'media') || jsonb_build_object('kind','supporting_image','contributionId',participant->>'contributionId'))
          FROM jsonb_array_elements(media_snapshot->'sources') participant WHERE participant->>'contributionId'=contribution_id::text),'[]'::jsonb)
      ELSE NULL END AS own_media
  FROM evidence
), facts AS (
  SELECT sources.*,
    CASE WHEN channel='website' AND own_source IS NOT NULL AND own_source ? 'company'
      THEN NULLIF(btrim(own_source->>'company'),'') IS NOT NULL AND position(own_source->>'company' in message)>0
      WHEN channel<>'website' AND own_source IS NOT NULL AND own_source ? 'name'
      THEN NULLIF(btrim(own_source->>'name'),'') IS NOT NULL AND position(own_source->>'name' in message)>0
      ELSE NULL END AS company_present,
    own_media IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(own_media,'[]'::jsonb)) image
      WHERE image->>'kind' NOT IN ('logo','supporting_image') OR image->>'kind' IS NULL
        OR image->>'contributionId' IS DISTINCT FROM contribution_id::text) AS media_collection_known,
    ARRAY(SELECT requirement FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(benefit->'requiredElements')='array'
      THEN benefit->'requiredElements' ELSE '[]'::jsonb END) requirement) AS required_elements
  FROM sources
), requirements AS (
  SELECT facts.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('element',requirement,'observation',
    CASE WHEN requirement='company_name' THEN CASE WHEN company_present IS TRUE THEN 'satisfied' WHEN company_present IS FALSE THEN 'missing' ELSE 'unknown' END
    WHEN requirement IN ('approved_logo','approved_presentation') THEN CASE
      WHEN channel<>'website' AND requirement='approved_presentation' AND benefit->>'format' IS DISTINCT FROM 'individual_portrait'
        AND benefit->>'format' IS DISTINCT FROM 'collective_composite' THEN 'unknown'
      WHEN NOT media_collection_known THEN 'unknown'
      WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(own_media) image
        WHERE image->>'kind'=CASE WHEN requirement='approved_logo' THEN 'logo' ELSE 'supporting_image' END) THEN 'missing'
      WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(own_media) image
        WHERE image->>'kind'=CASE WHEN requirement='approved_logo' THEN 'logo' ELSE 'supporting_image' END
          AND jsonb_typeof(image->'id')='string' AND image->>'id' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
          AND jsonb_typeof(image->'version')='string' AND NULLIF(btrim(image->>'version'),'') IS NOT NULL
          AND jsonb_typeof(COALESCE(image->'sourceHash',image->'hash'))='string' AND jsonb_typeof(image->'derivedHash')='string'
          AND COALESCE(image->>'sourceHash',image->>'hash') ~ '^[a-f0-9]{64}$' AND image->>'derivedHash' ~ '^[a-f0-9]{64}$'
          AND jsonb_typeof(image->'usage'->'channels')='array' AND jsonb_typeof(image->'usage'->'targets')='array'
          AND jsonb_typeof(image->'usage'->'transformations')='array'
          AND image->'usage'->>'state'='confirmed' AND (image->'usage'->'channels') ? channel AND (image->'usage'->'targets') ? target
          AND (image->'usage'->'transformations') ? 'technical'
          AND (NULLIF(image->'usage'->>'restrictions','') IS NULL OR image->>'restrictionsReviewed'='true')) THEN 'satisfied'
      ELSE 'unknown' END
    ELSE 'unknown' END) ORDER BY requirement) FROM unnest(required_elements) requirement),'[]'::jsonb) AS requirement_observations
  FROM facts
), classified AS MATERIALIZED (
  SELECT requirements.*,
    array_remove(ARRAY[
      CASE WHEN benefit->>'durationDays' IS NOT NULL AND NOT duration_verified THEN 'duration_unverified' END,
      CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(requirement_observations) observation WHERE observation->>'observation'='missing') THEN 'required_element_missing' END,
      CASE WHEN benefit IS NULL OR cardinality(required_elements)=0 OR own_source IS NULL
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(requirement_observations) observation WHERE observation->>'observation'='unknown') THEN 'snapshot_incomplete' END
    ],NULL) AS findings
  FROM requirements
)
`;

export const historicalAuditProjectionSql = projectionSql('');

/** The fixed API-owned scope is applied before materializing immutable proof snapshots. */
export const dossierFulfilmentQualificationSql = projectionSql(
  'AND e.contribution_id=$2::uuid'
);
