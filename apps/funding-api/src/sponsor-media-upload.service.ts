import { createHash, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import type {
  SponsorMediaAsset,
  SponsorMediaKind,
  SponsorMediaUploadResult
} from '@openg7/funding-core';

import { isValidUuid } from './business-helpers/request-validation.js';
import { insertAdminAuditLog } from './fund-admin-audit.repository.js';
import { processSponsorImage } from './sponsor-image.service.js';
import { createSponsorMediaAsset } from './sponsor-media/persistence-write.js';
import { getSponsorMediaStorageRecord } from './sponsor-media/persistence-read.js';
import { SponsorMediaPersistenceError } from './sponsor-media/persistence-error.js';
import { ModerationError } from './moderation/policy.js';
import type { SponsorMediaStorage } from './sponsor-media-storage.js';
import type { SponsorMediaStorageRecord } from './sponsor-media.repository.js';

export class SponsorMediaUploadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly assetId?: string
  ) {
    super(code);
    this.name = 'SponsorMediaUploadError';
  }
}
export interface SponsorMediaAdminUploadInput {
  readonly requestId: string;
  readonly contributionId: string;
  readonly kind: SponsorMediaKind;
  readonly filename: string;
  readonly contentType: string | null;
  readonly bytes: Buffer;
}
export const sponsorMediaUploadFingerprint = (
  input: SponsorMediaAdminUploadInput
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        action: 'upload',
        contributionId: input.contributionId.toLowerCase(),
        kind: input.kind,
        originalFilename: input.filename,
        originalChecksum: createHash('sha256').update(input.bytes).digest('hex')
      })
    )
    .digest('hex');

/** Canonical upload reuses the existing decoder and repository; new files start without inferred rights. */
export class SponsorMediaUploadService {
  constructor(
    private readonly pool: Pool,
    private readonly storage: Pick<
      SponsorMediaStorage,
      'driver' | 'writePrivateObject' | 'deletePrivateObject'
    >,
    private readonly limits: {
      readonly maxUploadBytes: number;
      readonly maxSupportingImages: number;
    }
  ) {}
  private async recorded(
    input: SponsorMediaAdminUploadInput,
    actor: string,
    fingerprint: string
  ): Promise<SponsorMediaUploadResult | null> {
    const row = (
      await this.pool.query<{
        actor: string;
        payload_fingerprint: string;
        result: { uploaded?: boolean; asset?: SponsorMediaAsset };
      }>(
        'SELECT actor,payload_fingerprint,result FROM sponsor_media_workspace_commands WHERE contribution_id=$1::uuid AND request_id=$2::uuid',
        [input.contributionId, input.requestId]
      )
    ).rows[0];
    if (!row) return null;
    if (
      row.actor !== actor ||
      row.payload_fingerprint !== fingerprint ||
      row.result.uploaded !== true ||
      !row.result.asset ||
      row.result.asset.contributionId !== input.contributionId
    )
      throw new SponsorMediaUploadError('MEDIA_REQUEST_CONFLICT', 409);
    return { uploaded: true, asset: row.result.asset };
  }
  private async cleanupReplaced(
    asset: SponsorMediaStorageRecord,
    input: SponsorMediaAdminUploadInput,
    replacementId: string,
    actor: string
  ): Promise<void> {
    const prefix = `sponsors/${input.contributionId}/${asset.id}/`;
    const keys = [asset.originalStorageKey, asset.processedStorageKey];
    const owned =
      asset.id !== replacementId &&
      asset.contributionId === input.contributionId &&
      keys.every((key) => key.startsWith(prefix));
    const outcomes = owned
      ? await Promise.allSettled(
          keys.map((key) =>
            Promise.resolve().then(() => this.storage.deletePrivateObject(key))
          )
        )
      : [];
    const complete =
      owned && outcomes.every((outcome) => outcome.status === 'fulfilled');
    // Upload and replacement are already committed. Cleanup/audit failure cannot invite another upload.
    const audited = await insertAdminAuditLog(this.pool, {
      actor,
      action: complete
        ? 'sponsorship.media.replacement_cleanup.completed'
        : 'sponsorship.media.replacement_cleanup.deferred',
      entityType: 'sponsor_media_asset',
      entityId: asset.id,
      summary: complete
        ? 'Replaced private media objects removed or already absent.'
        : 'Private replacement cleanup requires a later retry.',
      metadata: {
        contributionId: input.contributionId,
        requestId: input.requestId,
        replacementAssetId: replacementId,
        result: complete ? 'completed' : 'deferred'
      }
    }).catch(() => false);
    if (!audited)
      console.error('Sponsor media replacement cleanup audit is unavailable.', {
        code: 'MEDIA_REPLACEMENT_CLEANUP_AUDIT_UNAVAILABLE',
        assetId: asset.id,
        requestId: input.requestId
      });
  }
  async upload(
    raw: SponsorMediaAdminUploadInput,
    actor: string
  ): Promise<SponsorMediaUploadResult> {
    if (
      !isValidUuid(raw.requestId) ||
      !isValidUuid(raw.contributionId) ||
      !['logo', 'supporting_image'].includes(raw.kind) ||
      typeof raw.filename !== 'string' ||
      !raw.filename ||
      raw.filename.length > 500 ||
      !Buffer.isBuffer(raw.bytes) ||
      !raw.bytes.length ||
      typeof actor !== 'string' ||
      !actor.trim() ||
      actor.length > 200
    )
      throw new SponsorMediaUploadError('INVALID_MEDIA_UPLOAD_REQUEST', 400);
    if (raw.bytes.length > this.limits.maxUploadBytes)
      throw new SponsorMediaUploadError('SPONSOR_MEDIA_TOO_LARGE', 413);
    const input = {
      ...raw,
      requestId: raw.requestId.toLowerCase(),
      contributionId: raw.contributionId.toLowerCase()
    };
    const fingerprint = sponsorMediaUploadFingerprint(input);
    let originalKey: string | null = null,
      processedKey: string | null = null,
      assetId: string | undefined,
      persistenceAttempted = false;
    const cleanupOwnAttempt = async () => {
      const keys = [originalKey, processedKey];
      originalKey = null;
      processedKey = null;
      await Promise.allSettled(
        keys
          .filter((key): key is string => key !== null)
          .map((key) => this.storage.deletePrivateObject(key))
      );
    };
    try {
      const prior = await this.recorded(input, actor, fingerprint);
      if (prior) return prior; // Replay precedes image decoding, storage and quota checks.
      const contribution = (
        await this.pool.query<{ id: string }>(
          `SELECT id FROM fund_contributions WHERE id=$1::uuid AND contribution_type='sponsorship_interest' AND status IN ('paid','refunded','disputed')`,
          [input.contributionId]
        )
      ).rows[0];
      if (!contribution)
        throw new SponsorMediaUploadError('contribution_not_found', 404);
      const image = await processSponsorImage({
        data: input.bytes,
        kind: input.kind,
        originalFilename: input.filename
      }).catch(() => {
        throw new SponsorMediaUploadError('SPONSOR_MEDIA_INVALID_IMAGE', 400);
      });
      if (input.contentType && input.contentType !== image.originalMimeType)
        throw new SponsorMediaUploadError('SPONSOR_MEDIA_INVALID_IMAGE', 400);
      assetId = randomUUID();
      const base = `sponsors/${input.contributionId}/${assetId}`;
      originalKey = `${base}/original.${image.originalExtension}`;
      processedKey = `${base}/processed.webp`;
      await this.storage.writePrivateObject({
        key: originalKey,
        data: image.originalData,
        contentType: image.originalMimeType
      });
      await this.storage.writePrivateObject({
        key: processedKey,
        data: image.processedData,
        contentType: image.processedMimeType
      });
      persistenceAttempted = true;
      const result = await createSponsorMediaAsset(this.pool, {
        id: assetId,
        contributionId: input.contributionId,
        kind: input.kind,
        uploadedBy: 'admin',
        auditActor: actor,
        storageDriver: this.storage.driver,
        originalFilename: image.originalFilename,
        originalMimeType: image.originalMimeType,
        originalSizeBytes: image.originalSizeBytes,
        originalStorageKey: originalKey,
        processedSizeBytes: image.processedSizeBytes,
        processedStorageKey: processedKey,
        checksumSha256: image.checksumSha256,
        width: image.width,
        height: image.height,
        altText: null,
        maxSupportingImages: this.limits.maxSupportingImages,
        requestId: input.requestId,
        requestFingerprint: fingerprint
      });
      if (result.status !== 'created') {
        await cleanupOwnAttempt();
        throw new SponsorMediaUploadError(
          result.status,
          result.status === 'contribution_not_found' ? 404 : 409
        );
      }
      if (result.asset.id !== assetId)
        await cleanupOwnAttempt(); // A concurrent winner owns different keys.
      else {
        originalKey = null;
        processedKey = null;
      } // Committed keys are now owned by their asset.
      if (result.replaced && result.asset.id === assetId)
        await this.cleanupReplaced(
          result.replaced,
          input,
          result.asset.id,
          actor
        ).catch(() =>
          console.error('Sponsor media replacement cleanup is deferred.', {
            code: 'MEDIA_REPLACEMENT_CLEANUP_DEFERRED',
            assetId: result.replaced!.id,
            requestId: input.requestId
          })
        );
      return { uploaded: true, asset: result.asset };
    } catch (error) {
      if (!persistenceAttempted) {
        await cleanupOwnAttempt();
        if (error instanceof SponsorMediaUploadError) throw error;
        throw new SponsorMediaUploadError(
          'SPONSOR_MEDIA_UPLOAD_UNAVAILABLE',
          503
        );
      }
      if (error instanceof SponsorMediaUploadError) throw error; // Declined result already cleaned its nonce.
      let rollbackConfirmed = false;
      if (
        error instanceof SponsorMediaPersistenceError &&
        error.rollbackConfirmed &&
        assetId
      ) {
        // A lost COMMIT response may precede a successful ROLLBACK on an idle connection.
        // Verify absence before deleting; an unavailable or present asset keeps every object.
        try {
          rollbackConfirmed =
            (await getSponsorMediaStorageRecord(this.pool, assetId)) === null;
        } catch {
          /* Outcome remains uncertain. */
        }
      }
      if (!rollbackConfirmed)
        throw new SponsorMediaUploadError(
          'SPONSOR_MEDIA_UPLOAD_UNCONFIRMED',
          503,
          assetId
        );
      await cleanupOwnAttempt();
      if (
        error instanceof SponsorMediaPersistenceError &&
        error.cause instanceof ModerationError
      )
        throw new SponsorMediaUploadError(error.cause.code, error.cause.status);
      throw new SponsorMediaUploadError(
        'SPONSOR_MEDIA_UPLOAD_UNAVAILABLE',
        503
      );
    }
  }
}
