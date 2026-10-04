import type { SponsorMediaReviewStatus } from '@openg7/funding-core';
import type { Pool } from 'pg';

import { withPostgresTransaction } from '../postgres-transaction.js';

import type {
  CreateSponsorMediaAssetInput,
  CreateSponsorMediaAssetResult,
  SponsorMediaAssetRow,
  SponsorMediaMutationResult,
  SponsorMediaStorageRecord
} from './persistence-contracts.js';
import {
  editableContribution,
  mapAsset,
  mapStorageRecord
} from './persistence-mappers.js';
import {
  getAssetForUpdate,
  selectAssetColumns
} from './persistence-queries.js';
import { getSponsorMediaStorageRecord } from './persistence-read.js';

export const createSponsorMediaAsset = async (
  pool: Pool | null,
  input: CreateSponsorMediaAssetInput
): Promise<CreateSponsorMediaAssetResult> => {
  if (!pool) {
    return { status: 'contribution_not_found' };
  }
  return withPostgresTransaction<CreateSponsorMediaAssetResult>(
    pool,
    async (client) => {
      const contribution = await client.query<{
        readonly id: string;
        status: string;
        sponsor_review_status: string | null;
      }>(
        `SELECT id, status, sponsor_review_status
       FROM fund_contributions
       WHERE id = $1::uuid
         AND contribution_type = 'sponsorship_interest'
         AND status IN ('paid', 'refunded', 'disputed')
       FOR UPDATE`,
        [input.contributionId]
      );
      if (!contribution.rows[0]) {
        return { status: 'contribution_not_found' };
      }
      if (
        input.uploadedBy === 'sponsor' &&
        !editableContribution(contribution.rows[0])
      ) {
        return { status: 'not_editable' };
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
          return { status: 'supporting_image_limit_reached' };
        }
      }

      const sortOrderResult = await client.query<{
        readonly next_order: number;
      }>(
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
      return {
        status: 'created',
        asset: mapAsset(inserted.rows[0]!),
        replaced
      };
    },
    {
      shouldCommit: (result) => result.status === 'created',
      preserveOriginalError: true
    }
  );
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
  return withPostgresTransaction<SponsorMediaMutationResult>(
    pool,
    async (client) => {
      if (input.contributionId) {
        // Lock the dossier before the asset, as uploads do, and recheck a concurrent refusal.
        const contribution = await client.query<{
          status: string;
          sponsor_review_status: string | null;
        }>(
          `SELECT status, sponsor_review_status FROM fund_contributions
         WHERE id = $1::uuid AND contribution_type = 'sponsorship_interest' FOR UPDATE`,
          [input.contributionId]
        );
        if (
          !contribution.rows[0] ||
          !editableContribution(contribution.rows[0])
        ) {
          return { status: 'not_editable', asset: null };
        }
      }
      const row = await getAssetForUpdate(client, input.assetId);
      if (
        !row ||
        (input.contributionId && row.contribution_id !== input.contributionId)
      ) {
        return { status: 'not_found', asset: null };
      }
      const asset = mapStorageRecord(row);
      if (!input.allowApproved && row.review_status === 'approved') {
        return { status: 'approved_locked', asset };
      }
      if (row.version !== input.expectedVersion) {
        return { status: 'conflict', asset };
      }
      await client.query(
        `UPDATE sponsor_media_assets
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1::uuid`,
        [input.assetId]
      );
      return { status: 'updated', asset };
    },
    {
      shouldCommit: (result) => result.status === 'updated',
      preserveOriginalError: true
    }
  );
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
