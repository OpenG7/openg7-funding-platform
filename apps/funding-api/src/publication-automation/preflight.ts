import { isDeepStrictEqual } from 'node:util';

import type {
  PublicationDelivery,
  PublicationFeed,
  PublicationFeedId
} from '@openg7/funding-core';
import type { PublicationObligationSnapshot } from '@openg7/funding-core';

import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import { assertPublicationObligations } from '../sponsorship-fulfilment.repository.js';

import { type Media } from './media.js';
import {
  resolvePublicationVisual,
  type DerivedPublicationMedia,
  type VisualDelivery
} from './visuals.js';
import { canonicalPublicationAccount } from './account-reservations.js';
import { assertSponsorshipContent } from './content.js';
import { assert, validateContent } from './policy.js';
import { assertDeliveryModeration } from './moderation.js';
import {
  sourceEqual,
  sourceIssues,
  sources as loadSources,
  type Db,
  type Source
} from './sources.js';

export interface PreflightDelivery extends VisualDelivery {
  id: string;
  feed_id: PublicationFeedId;
  account_id: string;
  mode: PublicationDelivery['mode'];
  batch_id: string | null;
  approved_at: Date | null;
  source_snapshot: Source[];
  obligation_snapshot?: PublicationObligationSnapshot[];
  scheduled_at: Date;
  media_id: string | null;
  media_snapshot: Media | DerivedPublicationMedia | null;
  message: string;
}

export async function ready(
  db: Db,
  row: PreflightDelivery,
  storage: SponsorMediaStorage,
  feeds: (db: Db) => Promise<PublicationFeed[]>,
  lockSources = true
): Promise<Buffer | null> {
  validateContent(row.message, row.scheduled_at.toISOString());
  await assertDeliveryModeration(db, row);
  const feed = (await feeds(db)).find((f) => f.id === row.feed_id)!;
  assert(feed.configured && feed.connection === 'ready', 'CONNECTION_REQUIRED');
  assert(
    feed.accountId !== null &&
      canonicalPublicationAccount({ ...row, account_id: feed.accountId })
        .accountId === canonicalPublicationAccount(row).accountId &&
      feed.mode === row.mode,
    'DESTINATION_CHANGED'
  );
  if (row.batch_id) {
    // Lock the dossiers before checking their review timestamps. During
    // dispatch, a pending review is rejected below with its specific reason.
    const sources = await loadSources(
      db,
      row.batch_id,
      row.feed_id,
      Boolean(row.approved_at),
      lockSources
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
    await assertSponsorshipContent(db, row);
    if (row.approved_at) await assertPublicationObligations(db, row);
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
  const visual = await resolvePublicationVisual(db, storage, row, lockSources);
  assert(
    isDeepStrictEqual(visual.snapshot, row.media_snapshot),
    'MEDIA_CHANGED'
  );
  return visual.prepared?.bytes ?? null;
}
