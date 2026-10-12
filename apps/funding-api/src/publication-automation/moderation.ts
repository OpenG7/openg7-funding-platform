import { ModerationError } from '../moderation/policy.js';
import { assertModerationApproved } from '../moderation/repository.js';

import { PublicationAutomationError } from './policy.js';
import type { Db } from './sources.js';
import type { DerivedPublicationMedia } from './visuals.js';
import type { Media } from './media.js';

/** Revalidate the final rendering and its current moderation dependencies. */
export async function assertDeliveryModeration(
  db: Db,
  row: {
    id: string;
    batch_id: string | null;
    media_id: string | null;
    media_snapshot?: Media | DerivedPublicationMedia | null;
  }
): Promise<void> {
  try {
    await assertModerationApproved(db, {
      type: 'publication_delivery',
      id: row.id
    });
    if (row.batch_id) {
      const sources = await db.query<{ contribution_id: string }>(
        'SELECT DISTINCT contribution_id FROM sponsor_publication_drafts WHERE batch_id=$1 ORDER BY contribution_id',
        [row.batch_id]
      );
      for (const source of sources.rows)
        await assertModerationApproved(db, {
          type: 'sponsorship',
          id: source.contribution_id
        });
      // The final N0 covers drafts never individually reviewed. An existing
      // draft decision remains authoritative: a hold, refusal or stale review
      // cannot be bypassed by a delivery claim already in flight.
      const reviewedDrafts = await db.query<{ id: string }>(
        `SELECT draft.id FROM sponsor_publication_drafts draft
         JOIN moderation_cases review_case ON review_case.subject_type='publication_draft'
           AND review_case.subject_id=draft.id AND review_case.current_decision_id IS NOT NULL
         WHERE draft.batch_id=$1 ORDER BY draft.id`,
        [row.batch_id]
      );
      for (const draft of reviewedDrafts.rows)
        await assertModerationApproved(db, {
          type: 'publication_draft',
          id: draft.id
        });
    }
    if (row.media_id)
      await assertModerationApproved(db, { type: 'media', id: row.media_id });
    if (row.media_snapshot?.kind === 'derived')
      for (const source of row.media_snapshot.sources)
        await assertModerationApproved(db, {
          type: 'media',
          id: source.media.id
        });
  } catch (error) {
    if (error instanceof ModerationError)
      throw new PublicationAutomationError(error.code, error.status);
    throw error;
  }
}
