import type { Pool } from 'pg';
import type { SponsorMediaUploadResult } from '@openg7/funding-core';

import { processSponsorImage } from './sponsor-image.service.js';
import { createSponsorMediaAsset } from './sponsor-media/persistence-write.js';
import { getSponsorMediaStorageRecord } from './sponsor-media/persistence-read.js';
import { SponsorMediaPersistenceError } from './sponsor-media/persistence-error.js';
import { ModerationError } from './moderation/policy.js';
import type { SponsorMediaStorage } from './sponsor-media-storage.js';
import {
  normalizeUploadInput,
  readRecordedUpload,
  SponsorMediaUploadError,
  sponsorMediaUploadFingerprint,
  type SponsorMediaAdminUploadInput
} from './sponsor-media-upload/request.js';
import {
  cleanupReplacedUpload,
  SponsorMediaUploadObjects
} from './sponsor-media-upload/storage.js';

export {
  SponsorMediaUploadError,
  sponsorMediaUploadFingerprint,
  type SponsorMediaAdminUploadInput
} from './sponsor-media-upload/request.js';

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
  async upload(
    raw: SponsorMediaAdminUploadInput,
    actor: string
  ): Promise<SponsorMediaUploadResult> {
    const input = normalizeUploadInput(raw, actor, this.limits.maxUploadBytes);
    const fingerprint = sponsorMediaUploadFingerprint(input);
    let objects: SponsorMediaUploadObjects | undefined,
      persistenceAttempted = false;
    const cleanupOwnAttempt = async () => objects?.cleanup();
    try {
      const prior = await readRecordedUpload(
        this.pool,
        input,
        actor,
        fingerprint
      );
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
      objects = new SponsorMediaUploadObjects(
        this.storage,
        input.contributionId,
        image
      );
      await objects.write(image);
      persistenceAttempted = true;
      const result = await createSponsorMediaAsset(this.pool, {
        id: objects.assetId,
        contributionId: input.contributionId,
        kind: input.kind,
        uploadedBy: 'admin',
        auditActor: actor,
        storageDriver: this.storage.driver,
        originalFilename: image.originalFilename,
        originalMimeType: image.originalMimeType,
        originalSizeBytes: image.originalSizeBytes,
        originalStorageKey: objects.originalStorageKey,
        processedSizeBytes: image.processedSizeBytes,
        processedStorageKey: objects.processedStorageKey,
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
      if (result.asset.id !== objects.assetId)
        await cleanupOwnAttempt(); // A concurrent winner owns different keys.
      else objects.release();
      if (result.replaced && result.asset.id === objects.assetId)
        await cleanupReplacedUpload(
          this.pool,
          this.storage,
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
        objects?.assetId
      ) {
        // A lost COMMIT response may precede a successful ROLLBACK on an idle connection.
        // Verify absence before deleting; an unavailable or present asset keeps every object.
        try {
          rollbackConfirmed =
            (await getSponsorMediaStorageRecord(this.pool, objects.assetId)) ===
            null;
        } catch {
          /* Outcome remains uncertain. */
        }
      }
      if (!rollbackConfirmed)
        throw new SponsorMediaUploadError(
          'SPONSOR_MEDIA_UPLOAD_UNCONFIRMED',
          503,
          objects?.assetId
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
