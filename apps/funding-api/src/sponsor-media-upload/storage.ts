import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';
import type { ProcessedSponsorImage } from '../sponsor-image.service.js';
import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import type { SponsorMediaStorageRecord } from '../sponsor-media.repository.js';

import type { SponsorMediaAdminUploadInput } from './request.js';

/** Owns only the objects of one upload nonce until persistence transfers ownership. */
export class SponsorMediaUploadObjects {
  readonly assetId = randomUUID();
  readonly originalStorageKey: string;
  readonly processedStorageKey: string;
  private ownedKeys: string[];
  constructor(
    private readonly storage: Pick<
      SponsorMediaStorage,
      'writePrivateObject' | 'deletePrivateObject'
    >,
    contributionId: string,
    image: ProcessedSponsorImage
  ) {
    const base = `sponsors/${contributionId}/${this.assetId}`;
    this.originalStorageKey = `${base}/original.${image.originalExtension}`;
    this.processedStorageKey = `${base}/processed.webp`;
    this.ownedKeys = [this.originalStorageKey, this.processedStorageKey];
  }
  async write(image: ProcessedSponsorImage): Promise<void> {
    await this.storage.writePrivateObject({
      key: this.originalStorageKey,
      data: image.originalData,
      contentType: image.originalMimeType
    });
    await this.storage.writePrivateObject({
      key: this.processedStorageKey,
      data: image.processedData,
      contentType: image.processedMimeType
    });
  }
  async cleanup(): Promise<void> {
    const keys = this.ownedKeys;
    this.ownedKeys = [];
    await Promise.allSettled(
      keys.map((key) => this.storage.deletePrivateObject(key))
    );
  }
  release(): void {
    this.ownedKeys = []; // Committed keys are now owned by their asset.
  }
}

export async function cleanupReplacedUpload(
  pool: Pool,
  storage: Pick<SponsorMediaStorage, 'deletePrivateObject'>,
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
          Promise.resolve().then(() => storage.deletePrivateObject(key))
        )
      )
    : [];
  const complete =
    owned && outcomes.every((outcome) => outcome.status === 'fulfilled');
  // Upload and replacement are already committed. Cleanup/audit failure cannot invite another upload.
  const audited = await insertAdminAuditLog(pool, {
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
