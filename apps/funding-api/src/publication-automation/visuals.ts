import { isDeepStrictEqual } from 'node:util';

import type {
  PublicationFeedId,
  PublicationPhotoSelection,
  SponsorshipPublicationFormat
} from '@openg7/funding-core';

import { publicationFormatCapability } from '../../../../packages/funding-core/src/index.js';
import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import { getSponsorMediaPreference } from '../sponsor-media-usage.repository.js';
import {
  preparePublicationImage,
  preparePortraitImage
} from '../publication-image.service.js';
import { preparePublicationComposite } from '../publication-composite.service.js';

import { assert, digest, validId } from './policy.js';
import { resolveMedia, type Media } from './media.js';
import type { Db, Source } from './sources.js';

export interface DerivedPublicationMedia {
  readonly kind: 'derived';
  readonly id: string;
  readonly url: string;
  readonly alt: string;
  readonly hash: string;
  readonly derivedHash: string;
  readonly transform: string;
  readonly version: string;
  readonly format: SponsorshipPublicationFormat;
  readonly images?: readonly {
    readonly contributionId: string;
    readonly assetId: string;
    readonly alt: string;
    readonly derivedHash: string;
    readonly transform: string;
    readonly width: number;
    readonly height: number;
  }[];
  readonly sources: readonly {
    readonly contributionId: string;
    readonly name: string;
    readonly media: Media;
  }[];
}
export interface VisualDelivery {
  readonly id: string;
  readonly feed_id: PublicationFeedId;
  readonly batch_id: string | null;
  readonly media_id: string | null;
  readonly message: string;
  readonly source_snapshot: readonly Source[];
  readonly publication_format?: SponsorshipPublicationFormat;
  readonly photo_selections?: readonly PublicationPhotoSelection[];
}
export const normalisePublicationPhotos = (
  value: unknown
): PublicationPhotoSelection[] => {
  assert(
    Array.isArray(value) && value.length <= 10,
    'COMPOSITE_PARTICIPANTS_INVALID',
    400
  );
  const output = value.map((raw) => {
    assert(
      raw && typeof raw === 'object' && !Array.isArray(raw),
      'COMPOSITE_PARTICIPANTS_INVALID',
      400
    );
    const photo = raw as Record<string, unknown>;
    assert(
      Object.keys(photo).every((k) =>
        ['contributionId', 'assetId', 'assetVersion'].includes(k)
      ) &&
        validId(photo.contributionId) &&
        validId(photo.assetId) &&
        typeof photo.assetVersion === 'string' &&
        photo.assetVersion.length > 0 &&
        photo.assetVersion.length <= 128,
      'COMPOSITE_PARTICIPANTS_INVALID',
      400
    );
    return {
      contributionId: photo.contributionId.toLowerCase(),
      assetId: photo.assetId.toLowerCase(),
      assetVersion: photo.assetVersion
    };
  });
  assert(
    new Set(output.map((p) => p.contributionId)).size === output.length &&
      new Set(output.map((p) => p.assetId)).size === output.length,
    'COMPOSITE_PARTICIPANTS_INVALID',
    400
  );
  return output.sort((a, b) =>
    a.contributionId.localeCompare(b.contributionId)
  );
};

/** A private preparation can precede sponsor acceptance; dispatch passes false and rechecks every dependency. */
export async function resolvePublicationVisual(
  db: Db,
  storage: SponsorMediaStorage,
  row: VisualDelivery,
  lock = true,
  allowPendingSponsors = false,
  allowIncompletePreparation = false
) {
  const format = row.publication_format ?? 'collective_text';
  const [target, channel] = row.feed_id.split(':') as [
    'openg7' | 'openg20',
    'facebook' | 'linkedin'
  ];
  assert(
    publicationFormatCapability(channel, format).available,
    'FORMAT_UNAVAILABLE',
    400
  );
  if (format === 'collective_text') {
    assert(
      (row.photo_selections?.length ?? 0) === 0,
      'FORMAT_COMMITMENT_MISMATCH',
      400
    );
    const media = await resolveMedia(
      db,
      storage,
      row.media_id,
      row.batch_id,
      lock,
      { feedId: row.feed_id, message: row.message, allowPendingSponsors }
    );
    if (!media) return { snapshot: null, prepared: null };
    const bytes = await storage.readPrivateObject(media.key);
    assert(bytes && digest(bytes) === media.hash, 'MEDIA_CHANGED');
    const prepared = await preparePublicationImage(bytes);
    assert(
      channel !== 'linkedin' || prepared.width * prepared.height < 36_152_320,
      'MEDIA_DIMENSIONS_INVALID'
    );
    assert(
      prepared.sha256 === media.derivedHash &&
        prepared.transform === media.transform,
      'MEDIA_CHANGED'
    );
    return { snapshot: media, prepared };
  }
  assert(row.batch_id && !row.media_id, 'FORMAT_COMMITMENT_MISMATCH', 400);
  const ids = [
    ...new Set(row.source_snapshot.map((s) => s.contribution_id))
  ].sort();
  const photos = normalisePublicationPhotos(row.photo_selections ?? []);
  assert(
    format !== 'individual_portrait' || ids.length === 1,
    'PORTRAIT_REQUIRES_ONE_SPONSOR'
  );
  // Composition/edit may create a private workspace for scoped human selection.
  // Approval, authenticated JPEG preview and dispatch never enable this option.
  if (allowIncompletePreparation && !photos.length)
    return { snapshot: null, prepared: null };
  assert(
    format !== 'image_collection' || (ids.length >= 2 && ids.length <= 10),
    'COLLECTION_REQUIRES_MULTIPLE_SPONSORS'
  );
  assert(
    photos.length === ids.length &&
      isDeepStrictEqual(
        photos.map((p) => p.contributionId),
        ids
      ),
    'COMPOSITE_PHOTOS_REQUIRED'
  );
  const inputs = [];
  const snapshots = [];
  for (const photo of photos) {
    const owner = (
      await db.query<{ name: string; kind: string }>(
        `SELECT c.sponsor_company_name AS name,m.kind FROM sponsor_media_assets m
      JOIN fund_contributions c ON c.id=m.contribution_id WHERE m.id=$1::uuid AND c.id=$2::uuid AND m.deleted_at IS NULL`,
        [photo.assetId, photo.contributionId]
      )
    ).rows[0];
    assert(
      owner?.kind === 'supporting_image' && owner.name?.trim(),
      'COMPOSITE_PHOTOS_REQUIRED'
    );
    const preference = await getSponsorMediaPreference(
      db,
      photo.contributionId
    );
    assert(preference.state !== 'pending', 'MEDIA_PREFERENCE_REVIEW_REQUIRED');
    if (preference.state === 'accepted')
      assert(
        preference.available && preference.preferredAssetId === photo.assetId,
        'MEDIA_PREFERENCE_MISMATCH'
      );
    const media = await resolveMedia(
      db,
      storage,
      photo.assetId,
      row.batch_id,
      lock,
      {
        feedId: row.feed_id,
        message: row.message,
        allowPendingSponsors,
        transformations:
          format === 'image_collection'
            ? ['technical']
            : [
                'technical',
                format === 'individual_portrait' ? 'portrait' : 'composite'
              ]
      }
    );
    assert(media && media.version === photo.assetVersion, 'MEDIA_CHANGED');
    const bytes = await storage.readPrivateObject(media.key);
    assert(bytes && digest(bytes) === media.hash, 'MEDIA_CHANGED');
    inputs.push({
      contributionId: photo.contributionId,
      name: owner.name,
      credit: media.usage.credit,
      bytes,
      media: {
        contributionId: photo.contributionId,
        kind: 'supporting_image' as const,
        moderationApproved: true,
        usage: media.usage,
        restrictionsReviewed: media.restrictionsReviewed
      },
      channel,
      target
    });
    snapshots.push({
      contributionId: photo.contributionId,
      name: owner.name,
      media
    });
  }
  if (format === 'image_collection') {
    const images = [];
    for (const [index, input] of inputs.entries()) {
      const image = await preparePublicationImage(input.bytes);
      // LinkedIn's documented pixel ceiling is strict; reject before uploading.
      assert(
        image.width * image.height < 36_152_320,
        'MEDIA_DIMENSIONS_INVALID'
      );
      images.push({
        ...image,
        contributionId: input.contributionId,
        assetId: photos[index]!.assetId,
        alt: snapshots[index]!.media.alt
      });
    }
    const descriptors = images.map((image) => ({
      contributionId: image.contributionId,
      assetId: image.assetId,
      alt: image.alt,
      derivedHash: image.sha256,
      transform: image.transform,
      width: image.width,
      height: image.height
    }));
    const fingerprint = digest(
      JSON.stringify({
        format,
        photos,
        sources: snapshots,
        images: descriptors
      })
    );
    const snapshot: DerivedPublicationMedia = {
      kind: 'derived',
      id: row.id,
      url: `/api/admin/publication-automation/image-preview?deliveryId=${row.id}`,
      alt: images.map((image) => image.alt).join('; '),
      hash: digest(JSON.stringify(snapshots)),
      derivedHash: fingerprint,
      transform: 'ordered-jpeg-collection-v1',
      version: fingerprint,
      format,
      sources: snapshots,
      images: descriptors
    };
    return { snapshot, prepared: { kind: 'collection' as const, images } };
  }
  const prepared =
    format === 'individual_portrait'
      ? await preparePortraitImage(inputs[0]!)
      : await preparePublicationComposite(inputs);
  const snapshot: DerivedPublicationMedia = {
    kind: 'derived',
    id: row.id,
    url: `/api/admin/publication-automation/image-preview?deliveryId=${row.id}`,
    alt: inputs
      .map((source) => [source.name, source.credit].filter(Boolean).join(' — '))
      .join('; '),
    hash: digest(JSON.stringify(snapshots)),
    derivedHash: prepared.sha256,
    transform: prepared.transform,
    version: digest(
      JSON.stringify({
        format,
        photos,
        sources: snapshots,
        transform: prepared.transform
      })
    ),
    format,
    sources: snapshots
  };
  return { snapshot, prepared };
}

/** Called after compose/edit in the same transaction; no extra deletion grant or publication is needed. */
export async function capturePublicationPhotoDependencies(
  db: Db,
  row: VisualDelivery
): Promise<void> {
  await db.query(
    'UPDATE publication_delivery_photos SET active=FALSE WHERE delivery_id=$1::uuid AND active',
    [row.id]
  );
  for (const photo of row.photo_selections ?? [])
    await db.query(
      `INSERT INTO publication_delivery_photos(delivery_id,contribution_id,asset_id,asset_version)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4) ON CONFLICT(delivery_id,contribution_id) DO UPDATE SET
      asset_id=EXCLUDED.asset_id,asset_version=EXCLUDED.asset_version,active=TRUE`,
      [row.id, photo.contributionId, photo.assetId, photo.assetVersion]
    );
}

/** Scope validation precedes any combined dossier approval. */
export async function assertPublicationPhotoScope(
  db: Db,
  row: VisualDelivery
): Promise<void> {
  for (const photo of row.photo_selections ?? []) {
    const owned = await db.query(
      `SELECT m.id FROM sponsor_media_assets m WHERE m.id=$1::uuid AND m.contribution_id=$2::uuid
      AND EXISTS(SELECT 1 FROM sponsor_publication_drafts d WHERE d.batch_id=$3::uuid AND d.contribution_id=m.contribution_id) FOR SHARE OF m`,
      [photo.assetId, photo.contributionId, row.batch_id]
    );
    assert(owned.rowCount, 'MEDIA_NOT_APPROVED');
  }
}
