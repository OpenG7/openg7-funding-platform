import { isDeepStrictEqual } from 'node:util';

import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import { sponsorMediaPublicUrl } from '../sponsor-media/public-url.js';

import { assert, digest, validId } from './policy.js';
import type { Db } from './sources.js';

export interface Media {
  id: string;
  url: string;
  alt: string;
  key: string;
  hash: string;
  version: string;
}

export async function mediaOptions(
  db: Db
): Promise<{ id: string; url: string; alt: string; company: string }[]> {
  const result = await db.query(
    `SELECT m.id,m.public_url AS url,m.alt_text AS alt,c.sponsor_company_name AS company FROM sponsor_media_assets m JOIN fund_contributions c ON c.id=m.contribution_id WHERE m.deleted_at IS NULL AND m.review_status='approved' AND c.public_display_consent IS TRUE AND c.sponsor_review_status='approved' AND c.status='paid' AND m.public_url IS NOT NULL ORDER BY m.created_at DESC LIMIT 200`
  );
  return result.rows.map((row) => ({
    ...row,
    url: sponsorMediaPublicUrl(row.id)
  }));
}

export async function mediaRecord(
  db: Db,
  id: string
): Promise<Omit<Media, 'hash'> | undefined> {
  const record = (
    await db.query<Omit<Media, 'hash'>>(
      `SELECT m.id,m.public_url AS url,m.alt_text AS alt,m.processed_storage_key AS key,m.updated_at::text AS version FROM sponsor_media_assets m JOIN fund_contributions c ON c.id=m.contribution_id WHERE m.id=$1 AND m.deleted_at IS NULL AND m.review_status='approved' AND m.public_url IS NOT NULL AND LENGTH(TRIM(m.alt_text))>0 AND c.public_display_consent IS TRUE AND c.sponsor_review_status='approved' AND c.status='paid' FOR SHARE OF m,c`,
      [id]
    )
  ).rows[0];
  return record
    ? { ...record, url: sponsorMediaPublicUrl(record.id) }
    : undefined;
}

export async function resolveMedia(
  db: Db,
  storage: SponsorMediaStorage,
  id: string | null
): Promise<Media | null> {
  if (!id) return null;
  assert(validId(id), 'INVALID_MEDIA', 400);
  const r = await mediaRecord(db, id);
  assert(r, 'MEDIA_NOT_APPROVED');
  const bytes = await storage.readPrivateObject(r.key);
  assert(bytes, 'MEDIA_UNAVAILABLE');
  return { ...r, hash: digest(bytes) } as Media;
}

export function mediaSnapshotIssue(
  mediaId: string | null,
  snapshot: Media | null,
  record: Omit<Media, 'hash'> | null | undefined
): 'MEDIA_NOT_APPROVED' | 'MEDIA_CHANGED' | null {
  return mediaId
    ? !record
      ? 'MEDIA_NOT_APPROVED'
      : !snapshot ||
          !isDeepStrictEqual(record, {
            id: snapshot.id,
            url: snapshot.url,
            alt: snapshot.alt,
            key: snapshot.key,
            version: snapshot.version
          })
        ? 'MEDIA_CHANGED'
        : null
    : null;
}
