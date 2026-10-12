import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import sharp from 'sharp';
import type {
  SponsorMediaUsageRights,
  SponsorshipOfferedBenefit
} from '@openg7/funding-core';

import {
  normalizeSponsorMediaUsage,
  sponsorMediaUsageIssue
} from '../../../packages/funding-core/src/index.js';

import { ModerationError, moderationApprovedSql } from './moderation/policy.js';
import { confirmedMediaUsageSql } from './sponsor-media/usage-policy.js';
import type { SponsorMediaStorage } from './sponsor-media-storage.js';

type Db = Pool | PoolClient;
export type WebsiteMediaStorage = Pick<
  SponsorMediaStorage,
  'readPrivateObject'
>;

/** Server-only evidence of the controlled WebP sources; never a public DTO. */
export interface WebsiteMediaSource {
  readonly id: string;
  readonly contributionId: string;
  readonly kind: 'supporting_image' | 'logo';
  readonly version: string;
  readonly checksum: string;
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string | null;
  readonly usage: SponsorMediaUsageRights;
  readonly restrictionsReviewed: boolean;
}
export interface WebsiteMediaAttestation {
  readonly contributionId: string;
  readonly sources: readonly WebsiteMediaSource[];
}

/** Matches the public directory's first presentation photo and first qualified logo. */
export async function readWebsiteMediaSources(
  db: Db,
  contributionId: string,
  legacyLogoUrl: string | null
): Promise<WebsiteMediaSource[]> {
  const result = await db.query<{
    id: string;
    contribution_id: string;
    kind: 'supporting_image' | 'logo';
    version: string;
    checksum_sha256: string;
    processed_storage_key: string;
    processed_mime_type: string;
    width: number;
    height: number;
    alt_text: string | null;
    usage_rights: unknown;
    usage_restrictions_reviewed: boolean;
  }>(
    `SELECT m.id,m.contribution_id,m.kind,m.updated_at::text AS version,m.checksum_sha256,
      m.processed_storage_key,m.processed_mime_type,m.width,m.height,m.alt_text,
      m.usage_rights,m.usage_restrictions_reviewed
      FROM sponsor_media_assets m WHERE m.contribution_id=$1::uuid AND m.deleted_at IS NULL
        AND m.review_status='approved' AND m.public_url IS NOT NULL
        AND ${confirmedMediaUsageSql('m', 'website', 'openg7')}
        AND ${moderationApprovedSql('media', 'm.id')}
      ORDER BY m.kind,m.sort_order,m.created_at,m.id`,
    [contributionId]
  );
  const presentation = result.rows.find(
    (row) => row.kind === 'supporting_image'
  );
  const logo = result.rows.find((row) => row.kind === 'logo');
  if (!presentation || (legacyLogoUrl && !logo))
    throw new ModerationError('MEDIA_USAGE_CONFIRMATION_REQUIRED');
  return [presentation, ...(logo ? [logo] : [])].map((row) => {
    if (
      row.contribution_id !== contributionId ||
      !/^[a-f0-9]{64}$/.test(row.checksum_sha256) ||
      row.processed_mime_type !== 'image/webp' ||
      !row.processed_storage_key ||
      !Number.isSafeInteger(row.width) ||
      row.width <= 0 ||
      !Number.isSafeInteger(row.height) ||
      row.height <= 0
    )
      throw new ModerationError('MEDIA_CHANGED');
    const usage = normalizeSponsorMediaUsage(row.usage_rights);
    const issue = sponsorMediaUsageIssue(usage, {
      channel: 'website',
      target: 'openg7',
      transformations: ['technical'],
      restrictionsReviewed: row.usage_restrictions_reviewed === true,
      renderedCredit: usage.credit
    });
    if (issue) throw new ModerationError(issue);
    return {
      id: row.id,
      contributionId: row.contribution_id,
      kind: row.kind,
      version: row.version,
      checksum: row.checksum_sha256,
      storageKey: row.processed_storage_key,
      width: row.width,
      height: row.height,
      alt: row.alt_text,
      usage,
      restrictionsReviewed: row.usage_restrictions_reviewed === true
    };
  });
}

/** All storage I/O happens before the visibility transaction acquires any lock. */
export async function attestWebsiteMedia(
  db: Pool,
  storage: WebsiteMediaStorage | undefined,
  contributionId: string,
  legacyLogoUrl: string | null
): Promise<WebsiteMediaAttestation> {
  if (!storage) throw new ModerationError('MEDIA_STORAGE_UNAVAILABLE', 503);
  const sources = await readWebsiteMediaSources(
    db,
    contributionId,
    legacyLogoUrl
  );
  for (const source of sources) {
    let bytes: Buffer | null;
    try {
      bytes = await storage.readPrivateObject(source.storageKey);
    } catch {
      throw new ModerationError('MEDIA_STORAGE_UNAVAILABLE', 503);
    }
    if (!bytes) throw new ModerationError('MEDIA_UNAVAILABLE');
    if (createHash('sha256').update(bytes).digest('hex') !== source.checksum)
      throw new ModerationError('MEDIA_CHANGED');
    try {
      const metadata = await sharp(bytes, {
        limitInputPixels: 40_000_000
      }).metadata();
      if (
        metadata.format !== 'webp' ||
        metadata.width !== source.width ||
        metadata.height !== source.height
      )
        throw new ModerationError('MEDIA_CHANGED');
    } catch {
      throw new ModerationError('MEDIA_CHANGED');
    }
  }
  return { contributionId, sources };
}

export function assertWebsiteMediaAttested(
  contributionId: string,
  sources: readonly WebsiteMediaSource[],
  attestation: WebsiteMediaAttestation | null
): asserts attestation is WebsiteMediaAttestation {
  if (
    !attestation ||
    attestation.contributionId !== contributionId ||
    JSON.stringify(sources) !== JSON.stringify(attestation.sources)
  )
    throw new ModerationError('MEDIA_CHANGED');
}

/** Commercial requirements are checked against the exact controlled public artifacts. */
export function assertWebsiteRequiredElements(
  contributionId: string,
  requiredElements: SponsorshipOfferedBenefit['requiredElements'],
  companyName: string,
  displayed: readonly WebsiteMediaSource[],
  attestation: WebsiteMediaAttestation | null
): void {
  assertWebsiteMediaAttested(contributionId, displayed, attestation);
  const present = requiredElements.every((requirement) => {
    switch (requirement) {
      case 'company_name':
        return companyName.trim().length > 0;
      case 'approved_presentation':
        return displayed.some((source) => source.kind === 'supporting_image');
      case 'approved_logo':
        return displayed.some((source) => source.kind === 'logo');
      default:
        return false;
    }
  });
  if (!present) throw new ModerationError('REQUIRED_ELEMENTS_MISSING');
}
