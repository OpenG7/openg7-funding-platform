import type { PoolClient } from 'pg';

import type { SponsorMediaAssetRow } from './persistence-contracts.js';

export const selectAssetColumns = `
  id,
  contribution_id,
  kind,
  review_status,
  uploaded_by,
  original_filename,
  original_mime_type,
  original_size_bytes,
  original_storage_key,
  processed_mime_type,
  processed_size_bytes,
  processed_storage_key,
  public_storage_key,
  public_url,
  checksum_sha256,
  width,
  height,
  alt_text,
  sort_order,
  reviewed_at::text AS reviewed_at,
  updated_at::text AS version,
  created_at::text AS created_at
`;

export const getAssetForUpdate = async (
  client: PoolClient,
  assetId: string
): Promise<SponsorMediaAssetRow | null> => {
  const result = await client.query<SponsorMediaAssetRow>(
    `SELECT ${selectAssetColumns}
     FROM sponsor_media_assets
     WHERE id = $1::uuid AND deleted_at IS NULL
     FOR UPDATE`,
    [assetId]
  );
  return result.rows[0] ?? null;
};

export const publicMediaContributionSql = `
  contribution.status IN ('paid', 'refunded', 'disputed')
  AND contribution.public_display_consent IS TRUE
  AND contribution.sponsor_review_status = 'approved'
  AND COALESCE((to_jsonb(contribution)->>'sponsor_site_visibility_held')::boolean,FALSE) IS FALSE
`;
