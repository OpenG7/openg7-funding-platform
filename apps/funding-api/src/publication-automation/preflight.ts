import { isDeepStrictEqual } from 'node:util';

import sharp from 'sharp';
import type {
  PublicationDelivery,
  PublicationFeed,
  PublicationFeedId
} from '@openg7/funding-core';

import type { SponsorMediaStorage } from '../sponsor-media-storage.js';

import { resolveMedia, type Media } from './media.js';
import { assert, digest } from './policy.js';
import {
  sourceEqual,
  sourceIssues,
  sources as loadSources,
  type Db,
  type Source
} from './sources.js';

export interface PreflightDelivery {
  id: string;
  feed_id: PublicationFeedId;
  account_id: string;
  mode: PublicationDelivery['mode'];
  batch_id: string | null;
  approved_at: Date | null;
  source_snapshot: Source[];
  scheduled_at: Date;
  media_id: string | null;
  media_snapshot: Media | null;
}

export async function ready(
  db: Db,
  row: PreflightDelivery,
  storage: SponsorMediaStorage,
  feeds: (db: Db) => Promise<PublicationFeed[]>
): Promise<Buffer | null> {
  const feed = (await feeds(db)).find((f) => f.id === row.feed_id)!;
  assert(feed.configured && feed.connection === 'ready', 'CONNECTION_REQUIRED');
  assert(
    feed.accountId === row.account_id && feed.mode === row.mode,
    'DESTINATION_CHANGED'
  );
  if (row.batch_id) {
    // Lock the dossiers before checking their review timestamps. During
    // dispatch, a pending review is rejected below with its specific reason.
    const sources = await loadSources(
      db,
      row.batch_id,
      row.feed_id,
      Boolean(row.approved_at)
    );
    if (row.approved_at) {
      // Reapproving a dossier cannot revive an older delivery authorization.
      // Compare in PostgreSQL to preserve timestamp microsecond precision.
      const issues = await sourceIssues(db, row.id);
      assert(
        !issues.codes.includes('SPONSOR_REVIEW_REQUIRED'),
        'SPONSOR_REVIEW_REQUIRED'
      );
    }
    assert(sourceEqual(sources, row.source_snapshot), 'SOURCE_CHANGED');
  }
  if (row.batch_id && row.approved_at) {
    const batch = (
      await db.query(
        'SELECT status,scheduled_at FROM sponsor_publication_batches WHERE id=$1',
        [row.batch_id]
      )
    ).rows[0];
    assert(
      batch?.status === 'scheduled' &&
        batch.scheduled_at?.getTime() === row.scheduled_at.getTime(),
      'SOURCE_CHANGED'
    );
  }
  const media = await resolveMedia(db, storage, row.media_id, row.batch_id);
  assert(isDeepStrictEqual(media, row.media_snapshot), 'MEDIA_CHANGED');
  if (!media) return null;
  const bytes = await storage.readPrivateObject(media.key);
  assert(bytes && digest(bytes) === media.hash, 'MEDIA_CHANGED');
  return sharp(bytes).rotate().jpeg({ quality: 90 }).toBuffer();
}
