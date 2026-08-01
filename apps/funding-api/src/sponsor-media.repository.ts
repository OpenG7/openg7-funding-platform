import type {
  PublicSponsorMediaAsset,
  SponsorMediaAsset,
  SponsorMediaKind,
  SponsorMediaReviewStatus,
  SponsorMediaUploader
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

interface SponsorMediaAssetRow {
  readonly id: string;
  readonly contribution_id: string;
  readonly kind: SponsorMediaKind;
  readonly review_status: SponsorMediaReviewStatus;
  readonly uploaded_by: SponsorMediaUploader;
  readonly original_filename: string;
  readonly original_mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly original_size_bytes: number;
  readonly original_storage_key: string;
  readonly processed_mime_type: 'image/webp';
  readonly processed_size_bytes: number;
  readonly processed_storage_key: string;
  readonly public_storage_key: string | null;
  readonly public_url: string | null;
  readonly checksum_sha256: string;
  readonly width: number;
  readonly height: number;
  readonly alt_text: string | null;
  readonly sort_order: number;
  readonly reviewed_at: string | null;
  readonly version: string;
  readonly created_at: string;
}

export interface SponsorMediaStorageRecord extends SponsorMediaAsset {
  readonly originalStorageKey: string;
  readonly processedStorageKey: string;
  readonly publicStorageKey: string | null;
  readonly checksumSha256: string;
}

export interface CreateSponsorMediaAssetInput {
  readonly id: string;
  readonly contributionId: string;
  readonly kind: SponsorMediaKind;
  readonly uploadedBy: SponsorMediaUploader;
  readonly originalFilename: string;
  readonly originalMimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly originalSizeBytes: number;
  readonly originalStorageKey: string;
  readonly processedSizeBytes: number;
  readonly processedStorageKey: string;
  readonly checksumSha256: string;
  readonly width: number;
  readonly height: number;
  readonly altText: string | null;
  readonly maxSupportingImages: number;
}

export type CreateSponsorMediaAssetResult =
  | {
      readonly status: 'created';
      readonly asset: SponsorMediaAsset;
      readonly replaced: SponsorMediaStorageRecord | null;
    }
  | {
      readonly status:
        | 'contribution_not_found'
        | 'logo_locked'
        | 'supporting_image_limit_reached';
    };

export interface SponsorMediaMutationResult {
  readonly status: 'updated' | 'not_found' | 'conflict' | 'approved_locked';
  readonly asset: SponsorMediaStorageRecord | null;
}

const selectAssetColumns = `
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

const mapAsset = (row: SponsorMediaAssetRow): SponsorMediaAsset => ({
  id: row.id,
  contributionId: row.contribution_id,
  kind: row.kind,
  reviewStatus: row.review_status,
  uploadedBy: row.uploaded_by,
  originalFilename: row.original_filename,
  originalMimeType: row.original_mime_type,
  originalSizeBytes: row.original_size_bytes,
  processedMimeType: row.processed_mime_type,
  processedSizeBytes: row.processed_size_bytes,
  width: row.width,
  height: row.height,
  altText: row.alt_text,
  sortOrder: row.sort_order,
  publicUrl: row.public_url,
  reviewedAt: row.reviewed_at,
  version: row.version,
  createdAt: row.created_at
});

const mapStorageRecord = (
  row: SponsorMediaAssetRow
): SponsorMediaStorageRecord => ({
  ...mapAsset(row),
  originalStorageKey: row.original_storage_key,
  processedStorageKey: row.processed_storage_key,
  publicStorageKey: row.public_storage_key,
  checksumSha256: row.checksum_sha256
});

export const listSponsorMediaAssets = async (
  pool: Pool | null,
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

const getAssetForUpdate = async (
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

export const createSponsorMediaAsset = async (
  pool: Pool | null,
  input: CreateSponsorMediaAssetInput
): Promise<CreateSponsorMediaAssetResult> => {
  if (!pool) {
    return { status: 'contribution_not_found' };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contribution = await client.query<{ readonly id: string }>(
      `SELECT id
       FROM fund_contributions
       WHERE id = $1::uuid
         AND contribution_type = 'sponsorship_interest'
         AND status IN ('paid', 'refunded', 'disputed')
       FOR UPDATE`,
      [input.contributionId]
    );
    if (!contribution.rows[0]) {
      await client.query('ROLLBACK');
      return { status: 'contribution_not_found' };
    }

    let replaced: SponsorMediaStorageRecord | null = null;
    if (input.kind === 'logo') {
      const existing = await client.query<SponsorMediaAssetRow>(
        `SELECT ${selectAssetColumns}
         FROM sponsor_media_assets
         WHERE contribution_id = $1::uuid
           AND kind = 'logo'
           AND deleted_at IS NULL
         FOR UPDATE`,
        [input.contributionId]
      );
      if (existing.rows[0]?.review_status === 'approved') {
        await client.query('ROLLBACK');
        return { status: 'logo_locked' };
      }
      if (existing.rows[0]) {
        replaced = mapStorageRecord(existing.rows[0]);
        await client.query(
          `UPDATE sponsor_media_assets
           SET deleted_at = NOW(), updated_at = NOW()
           WHERE id = $1::uuid`,
          [existing.rows[0].id]
        );
      }
    } else {
      const count = await client.query<{ readonly count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM sponsor_media_assets
         WHERE contribution_id = $1::uuid
           AND kind = 'supporting_image'
           AND deleted_at IS NULL`,
        [input.contributionId]
      );
      if (Number(count.rows[0]?.count ?? 0) >= input.maxSupportingImages) {
        await client.query('ROLLBACK');
        return { status: 'supporting_image_limit_reached' };
      }
    }

    const sortOrderResult = await client.query<{ readonly next_order: number }>(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
       FROM sponsor_media_assets
       WHERE contribution_id = $1::uuid
         AND kind = $2
         AND deleted_at IS NULL`,
      [input.contributionId, input.kind]
    );
    const sortOrder =
      input.kind === 'logo' ? 0 : (sortOrderResult.rows[0]?.next_order ?? 0);
    const inserted = await client.query<SponsorMediaAssetRow>(
      `INSERT INTO sponsor_media_assets (
         id, contribution_id, kind, uploaded_by, original_filename,
         original_mime_type, original_size_bytes, original_storage_key,
         processed_size_bytes, processed_storage_key, checksum_sha256,
         width, height, alt_text, sort_order
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15
       )
       RETURNING ${selectAssetColumns}`,
      [
        input.id,
        input.contributionId,
        input.kind,
        input.uploadedBy,
        input.originalFilename,
        input.originalMimeType,
        input.originalSizeBytes,
        input.originalStorageKey,
        input.processedSizeBytes,
        input.processedStorageKey,
        input.checksumSha256,
        input.width,
        input.height,
        input.altText,
        sortOrder
      ]
    );
    if (input.uploadedBy === 'sponsor') {
      await client.query(
        `UPDATE fund_contributions
         SET sponsor_review_status = 'pending_review',
             sponsor_reviewed_at = NULL,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [input.contributionId]
      );
    }
    await client.query('COMMIT');
    return {
      status: 'created',
      asset: mapAsset(inserted.rows[0]!),
      replaced
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const deleteSponsorMediaAsset = async (
  pool: Pool | null,
  input: {
    readonly assetId: string;
    readonly contributionId?: string;
    readonly expectedVersion: string;
    readonly allowApproved: boolean;
  }
): Promise<SponsorMediaMutationResult> => {
  if (!pool) {
    return { status: 'not_found', asset: null };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await getAssetForUpdate(client, input.assetId);
    if (
      !row ||
      (input.contributionId && row.contribution_id !== input.contributionId)
    ) {
      await client.query('ROLLBACK');
      return { status: 'not_found', asset: null };
    }
    const asset = mapStorageRecord(row);
    if (!input.allowApproved && row.review_status === 'approved') {
      await client.query('ROLLBACK');
      return { status: 'approved_locked', asset };
    }
    if (row.version !== input.expectedVersion) {
      await client.query('ROLLBACK');
      return { status: 'conflict', asset };
    }
    await client.query(
      `UPDATE sponsor_media_assets
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1::uuid`,
      [input.assetId]
    );
    await client.query('COMMIT');
    return { status: 'updated', asset };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const reviewSponsorMediaAsset = async (
  pool: Pool | null,
  input: {
    readonly assetId: string;
    readonly expectedVersion: string;
    readonly reviewStatus: Exclude<SponsorMediaReviewStatus, 'pending_review'>;
    readonly altText: string | null;
    readonly publicStorageKey: string | null;
    readonly publicUrl: string | null;
    readonly reviewedBy: string;
  }
): Promise<SponsorMediaMutationResult> => {
  if (!pool) {
    return { status: 'not_found', asset: null };
  }
  const result = await pool.query<SponsorMediaAssetRow>(
    `UPDATE sponsor_media_assets
     SET review_status = $2,
         alt_text = $3,
         public_storage_key = $4,
         public_url = $5,
         reviewed_at = NOW(),
         reviewed_by = $6,
         updated_at = NOW()
     WHERE id = $1::uuid
       AND deleted_at IS NULL
       AND updated_at::text = $7
     RETURNING ${selectAssetColumns}`,
    [
      input.assetId,
      input.reviewStatus,
      input.altText,
      input.publicStorageKey,
      input.publicUrl,
      input.reviewedBy,
      input.expectedVersion
    ]
  );
  if (result.rows[0]) {
    return { status: 'updated', asset: mapStorageRecord(result.rows[0]) };
  }
  const current = await getSponsorMediaStorageRecord(pool, input.assetId);
  return { status: current ? 'conflict' : 'not_found', asset: current };
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
     WHERE contribution.status IN ('paid', 'refunded', 'disputed')
       AND contribution.public_display_consent IS TRUE
       AND contribution.sponsor_review_status = 'approved'
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
           AND contribution.status IN ('paid', 'refunded', 'disputed')
           AND contribution.public_display_consent IS TRUE
           AND contribution.sponsor_review_status = 'approved'
       )`,
    [assetId]
  );
  return result.rows[0] ? mapStorageRecord(result.rows[0]) : null;
};
