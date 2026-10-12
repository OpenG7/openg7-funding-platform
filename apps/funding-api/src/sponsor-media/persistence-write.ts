import type {
  ModerationDecisionInput,
  SponsorMediaReviewStatus
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import {
  approveModeratedSubject,
  auditModeratedMutation,
  recordAdverseModeration
} from '../moderation-legacy.js';
import { ModerationError } from '../moderation/policy.js';
import { SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH } from '../business-helpers/request-validation.js';
import { lockModerationDependencies } from '../moderation/content.js';

import type {
  CreateSponsorMediaAssetInput,
  CreateSponsorMediaAssetResult,
  SponsorMediaAssetRow,
  SponsorMediaMutationResult,
  SponsorMediaStorageRecord
} from './persistence-contracts.js';
import { SponsorMediaPersistenceError } from './persistence-error.js';
import {
  editableContribution,
  mapAsset,
  mapStorageRecord
} from './persistence-mappers.js';
import {
  getAssetForUpdate,
  selectAssetColumns
} from './persistence-queries.js';

const createMediaTransaction = async (
  pool: Pool,
  operation: (client: PoolClient) => Promise<CreateSponsorMediaAssetResult>
): Promise<CreateSponsorMediaAssetResult> => {
  let rollbackConfirmed = false;
  try {
    return await withPostgresTransaction(pool, operation, {
      shouldCommit: (result) => result.status === 'created',
      preserveOriginalError: true,
      onRollbackConfirmed: () => {
        rollbackConfirmed = true;
      }
    });
  } catch (cause) {
    throw new SponsorMediaPersistenceError(cause, rollbackConfirmed);
  }
};

export const createSponsorMediaAsset = async (
  pool: Pool | null,
  input: CreateSponsorMediaAssetInput
): Promise<CreateSponsorMediaAssetResult> => {
  if (!pool) {
    return { status: 'contribution_not_found' };
  }
  return createMediaTransaction(pool, async (client) => {
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
    const audited = await insertAdminAuditLog(client, {
      actor: input.auditActor,
      action: 'sponsorship.media.upload',
      entityType: 'sponsor_media_asset',
      entityId: input.id,
      summary: 'Sponsor media uploaded through the private follow-up flow.',
      metadata: {
        contributionId: input.contributionId,
        kind: input.kind,
        mimeType: input.originalMimeType,
        sizeBytes: input.originalSizeBytes,
        storageDriver: input.storageDriver
      }
    });
    if (!audited) {
      throw new Error('Sponsor media upload audit is unavailable.');
    }
    return {
      status: 'created',
      asset: mapAsset(inserted.rows[0]!),
      replaced
    };
  });
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
    readonly confirmation?: string;
    readonly moderationDecision?: ModerationDecisionInput;
  }
): Promise<SponsorMediaMutationResult> => {
  if (!pool) {
    return { status: 'not_found', asset: null };
  }
  return withPostgresTransaction(
    pool,
    async (db) => {
      if (input.reviewStatus === 'rejected')
        await lockModerationDependencies(db, {
          type: 'media',
          id: input.assetId
        });
      const current = await getAssetForUpdate(db, input.assetId);
      if (!current) return { status: 'not_found', asset: null } as const;
      if (current.version !== input.expectedVersion)
        return {
          status: 'conflict',
          asset: mapStorageRecord(current)
        } as const;
      if (
        (input.confirmation ?? input.moderationDecision?.confirmation) !==
        input.assetId
      )
        throw new ModerationError('CONFIRMATION_REQUIRED', 400);
      const subject = { type: 'media', id: input.assetId } as const;
      if (input.reviewStatus === 'rejected') {
        await recordAdverseModeration(
          db,
          subject,
          input.reviewedBy,
          input.moderationDecision,
          ['N3']
        );
        const reviewed = await getAssetForUpdate(db, input.assetId);
        return {
          status: 'updated',
          asset: reviewed ? mapStorageRecord(reviewed) : null
        } as const;
      }
      if ((current.alt_text?.trim() || null) !== input.altText)
        throw new ModerationError('MODERATION_CONTENT_CHANGED');
      await approveModeratedSubject(
        db,
        subject,
        input.reviewedBy,
        input.moderationDecision
      );
      const result = await db.query<SponsorMediaAssetRow>(
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
        await auditModeratedMutation(
          db,
          subject,
          input.reviewedBy,
          'sponsorship.media.approved'
        );
        return { status: 'updated', asset: mapStorageRecord(result.rows[0]) };
      }
      return { status: 'conflict', asset: mapStorageRecord(current) } as const;
    },
    { shouldCommit: (result) => result.status === 'updated' }
  );
};

/** Prepare an edited public caption before a separate review of its exact content. */
export const updateSponsorMediaMetadata = async (
  pool: Pool | null,
  input: {
    readonly assetId: string;
    readonly expectedVersion: string;
    readonly confirmation: string;
    readonly altText: string | null;
    readonly actor: string;
  }
): Promise<SponsorMediaMutationResult> => {
  if (!pool) return { status: 'not_found', asset: null };
  if (input.confirmation !== input.assetId)
    throw new ModerationError('CONFIRMATION_REQUIRED', 400);
  if (
    input.altText != null &&
    (typeof input.altText !== 'string' ||
      input.altText.length > SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH)
  )
    throw new ModerationError('INVALID_MEDIA_METADATA', 400);
  return withPostgresTransaction(
    pool,
    async (db) => {
      await lockModerationDependencies(db, {
        type: 'media',
        id: input.assetId
      });
      const current = await getAssetForUpdate(db, input.assetId);
      if (!current) return { status: 'not_found', asset: null } as const;
      if (current.version !== input.expectedVersion)
        return {
          status: 'conflict',
          asset: mapStorageRecord(current)
        } as const;
      const altText = input.altText?.trim() || null;
      if ((current.alt_text?.trim() || null) === altText)
        return { status: 'updated', asset: mapStorageRecord(current) } as const;
      const result = await db.query<SponsorMediaAssetRow>(
        `UPDATE sponsor_media_assets SET alt_text=$2,review_status='pending_review',public_url=NULL,reviewed_at=NULL,reviewed_by=NULL,updated_at=NOW() WHERE id=$1 RETURNING ${selectAssetColumns}`,
        [input.assetId, altText]
      );
      const audited = await insertAdminAuditLog(db, {
        actor: input.actor,
        action: 'sponsorship.media.metadata',
        entityType: 'sponsor_media_asset',
        entityId: input.assetId,
        summary: 'Sponsor media caption changed and requires a new review.',
        metadata: { contributionId: current.contribution_id }
      });
      if (!audited)
        throw new Error('Sponsor media metadata audit is unavailable.');
      return {
        status: 'updated',
        asset: mapStorageRecord(result.rows[0]!)
      } as const;
    },
    { shouldCommit: (result) => result.status === 'updated' }
  );
};
