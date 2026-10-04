import type {
  PublicSponsorMediaAsset,
  SponsorMediaAsset,
  SponsorMediaKind
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import type {
  SponsorMediaAssetRow,
  SponsorMediaStorageRecord
} from './persistence-contracts.js';
import {
  editableContribution,
  mapAsset,
  mapStorageRecord
} from './persistence-mappers.js';
import {
  publicMediaContributionSql,
  selectAssetColumns
} from './persistence-queries.js';

export const listSponsorMediaAssets = async (
  pool: Pool | PoolClient | null,
  contributionId: string
): Promise<readonly SponsorMediaAsset[]> => {
  if (!pool) {
    return [];
  }
  const result = await pool.query<SponsorMediaAssetRow>(
    `SELECT ${selectAssetColumns}
     FROM sponsor_media_assets
     WHERE contribution_id = $1::uuid AND deleted_at IS NULL
     ORDER BY kind, sort_order, created_at`,
    [contributionId]
  );
  return result.rows.map(mapAsset);
};

export const getSponsorMediaStorageRecord = async (
  pool: Pool | null,
  assetId: string
): Promise<SponsorMediaStorageRecord | null> => {
  if (!pool) {
    return null;
  }
  const result = await pool.query<SponsorMediaAssetRow>(
    `SELECT ${selectAssetColumns}
     FROM sponsor_media_assets
     WHERE id = $1::uuid AND deleted_at IS NULL`,
    [assetId]
  );
  return result.rows[0] ? mapStorageRecord(result.rows[0]) : null;
};

/** Cheap preflight before decoding/storage; the transaction still enforces the quota. */
export const checkSponsorMediaUpload = async (
  pool: Pool | null,
  contributionId: string,
  kind: SponsorMediaKind,
  maxSupportingImages: number
): Promise<
  | 'allowed'
  | 'contribution_not_found'
  | 'not_editable'
  | 'logo_locked'
  | 'supporting_image_limit_reached'
> => {
  if (!pool) return 'contribution_not_found';
  const result = await pool.query<{
    status: string;
    sponsor_review_status: string | null;
    supporting_count: string;
    approved_logo: boolean;
  }>(
    `SELECT c.status, c.sponsor_review_status,
      (SELECT COUNT(*)::text FROM sponsor_media_assets m WHERE m.contribution_id = c.id AND m.kind = 'supporting_image' AND m.deleted_at IS NULL) AS supporting_count,
      EXISTS (SELECT 1 FROM sponsor_media_assets m WHERE m.contribution_id = c.id AND m.kind = 'logo' AND m.review_status = 'approved' AND m.deleted_at IS NULL) AS approved_logo
     FROM fund_contributions c WHERE c.id = $1::uuid AND c.contribution_type = 'sponsorship_interest'`,
    [contributionId]
  );
  const row = result.rows[0];
  if (!row) return 'contribution_not_found';
  if (!editableContribution(row)) return 'not_editable';
  if (kind === 'logo') return row.approved_logo ? 'logo_locked' : 'allowed';
  return Number(row.supporting_count) >= maxSupportingImages
    ? 'supporting_image_limit_reached'
    : 'allowed';
};

export const listPublicSponsorMediaByContributionIds = async (
  pool: Pool | null,
  contributionIds: readonly string[]
): Promise<ReadonlyMap<string, readonly PublicSponsorMediaAsset[]>> => {
  if (!pool || contributionIds.length === 0) {
    return new Map();
  }
  const presence = await pool.query<{ readonly exists: boolean }>(
    `SELECT to_regclass('public.sponsor_media_assets') IS NOT NULL AS exists`
  );
  if (!presence.rows[0]?.exists) {
    return new Map();
  }
  const result = await pool.query<
    SponsorMediaAssetRow & { readonly company_name: string }
  >(
    `SELECT media.*, contribution.sponsor_company_name AS company_name
     FROM (
       SELECT ${selectAssetColumns}
       FROM sponsor_media_assets
       WHERE contribution_id = ANY($1::uuid[])
         AND deleted_at IS NULL
         AND review_status = 'approved'
         AND public_url IS NOT NULL
     ) AS media
     INNER JOIN fund_contributions AS contribution
       ON contribution.id = media.contribution_id
     WHERE ${publicMediaContributionSql}
     ORDER BY media.kind, media.sort_order, media.created_at`,
    [contributionIds]
  );
  const grouped = new Map<string, PublicSponsorMediaAsset[]>();
  for (const row of result.rows) {
    const assets = grouped.get(row.contribution_id) ?? [];
    assets.push({
      id: row.id,
      kind: row.kind,
      url: row.public_url!,
      width: row.width,
      height: row.height,
      alt_text:
        row.alt_text?.trim() || `${row.company_name} - image commanditaire`,
      sort_order: row.sort_order
    });
    grouped.set(row.contribution_id, assets);
  }
  return grouped;
};

export const getApprovedPublicSponsorMedia = async (
  pool: Pool | null,
  assetId: string
): Promise<SponsorMediaStorageRecord | null> => {
  if (!pool) {
    return null;
  }
  const result = await pool.query<SponsorMediaAssetRow>(
    `SELECT ${selectAssetColumns}
     FROM sponsor_media_assets AS media
     WHERE media.id = $1::uuid
       AND media.deleted_at IS NULL
       AND media.review_status = 'approved'
       AND EXISTS (
         SELECT 1
         FROM fund_contributions AS contribution
         WHERE contribution.id = media.contribution_id
           AND ${publicMediaContributionSql}
       )`,
    [assetId]
  );
  return result.rows[0] ? mapStorageRecord(result.rows[0]) : null;
};
