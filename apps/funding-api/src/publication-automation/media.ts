import { isDeepStrictEqual } from 'node:util';

import type {
  PublicationFeedId,
  SponsorMediaUsageRights,
  SponsorMediaTransformation
} from '@openg7/funding-core';

import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import { sponsorMediaPublicUrl } from '../sponsor-media/public-url.js';
import { moderationApprovedSql } from '../moderation/policy.js';
import {
  normalizeSponsorMediaUsage,
  sponsorMediaUsageIssue
} from '../../../../packages/funding-core/src/index.js';
import { preparePublicationImage } from '../publication-image.service.js';
import { confirmedMediaUsageSql } from '../sponsor-media/usage-policy.js';

import { assert, digest, validId } from './policy.js';
import type { Db } from './sources.js';
import type { DerivedPublicationMedia } from './visuals.js';

export interface Media {
  kind?: 'source';
  id: string;
  url: string;
  alt: string;
  key: string;
  hash: string;
  derivedHash: string;
  transform: string;
  usage: SponsorMediaUsageRights;
  restrictionsReviewed: boolean;
  version: string;
}

const belongsToBatchSql = (parameter: '$1' | '$2') =>
  `EXISTS(SELECT 1 FROM sponsor_publication_drafts s WHERE s.batch_id=${parameter}::uuid AND s.contribution_id=m.contribution_id)`;

export async function mediaOptions(
  db: Db,
  batchId: string | null = null,
  feedId?: PublicationFeedId
): Promise<
  {
    id: string;
    url: string;
    alt: string;
    company: string;
    credit: string | null;
    contributionId: string;
    version: string;
    kind: string;
    transformations: readonly string[];
  }[]
> {
  const [target, channel] =
    (feedId?.split(':') as ['openg7' | 'openg20', 'facebook' | 'linkedin']) ??
    [];
  const result = await db.query(
    `SELECT m.id,m.contribution_id AS "contributionId",m.updated_at::text AS version,m.kind,m.usage_rights->'transformations' AS transformations,m.public_url AS url,m.alt_text AS alt,c.sponsor_company_name AS company,m.usage_rights->>'credit' AS credit FROM sponsor_media_assets m JOIN fund_contributions c ON c.id=m.contribution_id WHERE m.deleted_at IS NULL AND m.review_status='approved' AND ${moderationApprovedSql('media', 'm.id')} AND ${moderationApprovedSql('sponsorship', 'c.id')} AND ${confirmedMediaUsageSql('m', channel, target)} AND c.public_display_consent IS TRUE AND c.sponsor_review_status='approved' AND c.status='paid' AND m.public_url IS NOT NULL AND ($1::uuid IS NULL OR ${belongsToBatchSql('$1')}) ORDER BY m.created_at DESC LIMIT 200`,
    [batchId]
  );
  return result.rows.map((row) => ({
    ...row,
    url: sponsorMediaPublicUrl(row.id)
  }));
}

export async function mediaRecord(
  db: Db,
  id: string,
  batchId: string | null = null,
  lock = true,
  allowPendingSponsors = false
): Promise<Omit<Media, 'derivedHash' | 'transform'> | undefined> {
  const record = (
    await db.query<Omit<Media, 'derivedHash' | 'transform'>>(
      `SELECT m.id,m.public_url AS url,m.alt_text AS alt,m.processed_storage_key AS key,m.updated_at::text AS version,m.checksum_sha256 AS hash,
        m.usage_rights AS usage,m.usage_restrictions_reviewed AS "restrictionsReviewed"
        FROM sponsor_media_assets m JOIN fund_contributions c ON c.id=m.contribution_id WHERE m.id=$1 AND m.deleted_at IS NULL AND m.review_status='approved' AND ${moderationApprovedSql('media', 'm.id')} AND (${allowPendingSponsors ? `c.sponsor_review_status='pending_review' OR ` : ''}(${moderationApprovedSql('sponsorship', 'c.id')} AND c.sponsor_review_status='approved')) AND m.public_url IS NOT NULL AND LENGTH(TRIM(m.alt_text))>0 AND c.public_display_consent IS TRUE AND c.status='paid' AND ($2::uuid IS NULL OR ${belongsToBatchSql('$2')})${lock ? ' FOR SHARE OF m,c' : ''}`,
      [id, batchId]
    )
  ).rows[0];
  return record
    ? {
        ...record,
        url: sponsorMediaPublicUrl(record.id),
        usage: normalizeSponsorMediaUsage(record.usage),
        restrictionsReviewed: record.restrictionsReviewed === true
      }
    : undefined;
}

export async function resolveMedia(
  db: Db,
  storage: SponsorMediaStorage,
  id: string | null,
  batchId: string | null = null,
  lock = true,
  context?: {
    readonly feedId: PublicationFeedId;
    readonly message: string;
    readonly transformations?: readonly SponsorMediaTransformation[];
    readonly allowPendingSponsors?: boolean;
  }
): Promise<Media | null> {
  if (!id) return null;
  assert(validId(id), 'INVALID_MEDIA', 400);
  const r = await mediaRecord(
    db,
    id,
    batchId,
    lock,
    context?.allowPendingSponsors
  );
  assert(r, 'MEDIA_NOT_APPROVED');
  if (context) {
    const [target, channel] = context.feedId.split(':') as [
      'openg7' | 'openg20',
      'facebook' | 'linkedin'
    ];
    const creditIncluded =
      r.usage.credit &&
      context.message
        .split('\n')
        .some((line) => line.trim() === r.usage.credit);
    const issue = sponsorMediaUsageIssue(r.usage, {
      channel,
      target,
      transformations: context.transformations ?? ['technical'],
      restrictionsReviewed: r.restrictionsReviewed,
      renderedCredit: creditIncluded ? r.usage.credit : null
    });
    assert(!issue, issue ?? 'MEDIA_USAGE_CONFIRMATION_REQUIRED');
  } else
    assert(r.usage.state === 'confirmed', 'MEDIA_USAGE_CONFIRMATION_REQUIRED');
  const bytes = await storage.readPrivateObject(r.key);
  assert(bytes, 'MEDIA_UNAVAILABLE');
  assert(
    /^[a-f0-9]{64}$/.test(r.hash) && digest(bytes) === r.hash,
    'MEDIA_CHANGED'
  );
  const prepared = await preparePublicationImage(bytes);
  return {
    ...r,
    hash: digest(bytes),
    derivedHash: prepared.sha256,
    transform: prepared.transform
  };
}

/** Check ownership before a combined approval changes pending sponsor reviews. */
export async function assertMediaScope(
  db: Db,
  id: string | null,
  batchId: string | null
): Promise<void> {
  if (!id || !batchId) return;
  const result = await db.query(
    `SELECT m.id FROM sponsor_media_assets m WHERE m.id=$1 AND ${belongsToBatchSql('$2')} FOR SHARE OF m`,
    [id, batchId]
  );
  assert(result.rowCount, 'MEDIA_NOT_APPROVED');
}

export function mediaSnapshotIssue(
  mediaId: string | null,
  snapshot: Media | DerivedPublicationMedia | null,
  record: Omit<Media, 'derivedHash' | 'transform'> | null | undefined
): 'MEDIA_NOT_APPROVED' | 'MEDIA_CHANGED' | null {
  if (snapshot?.kind === 'derived') return mediaId ? 'MEDIA_CHANGED' : null;
  return mediaId
    ? !record
      ? 'MEDIA_NOT_APPROVED'
      : !snapshot ||
          !isDeepStrictEqual(record, {
            id: snapshot.id,
            url: snapshot.url,
            alt: snapshot.alt,
            key: snapshot.key,
            version: snapshot.version,
            hash: snapshot.hash,
            usage: snapshot.usage,
            restrictionsReviewed: snapshot.restrictionsReviewed
          })
        ? 'MEDIA_CHANGED'
        : null
    : null;
}
