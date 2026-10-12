import { withPostgresTransaction } from '../postgres-transaction.js';

import {
  audit,
  type DeliveryRow,
  type PublicationPlanningContext
} from './context.js';
import { mediaRecord, mediaSnapshotIssue } from './media.js';
import { sourceIssues } from './sources.js';

export async function guardEligibility(
  context: PublicationPlanningContext
): Promise<void> {
  await withPostgresTransaction(context.pool, async (db) => {
    const rows = (
      await db.query<DeliveryRow>(
        "SELECT * FROM publication_deliveries WHERE status IN ('draft','approved') AND (batch_id IS NOT NULL OR media_id IS NOT NULL) ORDER BY id FOR UPDATE SKIP LOCKED"
      )
    ).rows;
    for (const row of rows) {
      const issues = await sourceIssues(db, row.id);
      if (issues.codes.length) {
        await db.query(
          "UPDATE publication_deliveries SET status='blocked',approved_at=NULL,approved_by=NULL,error_code=$2,version=version+1,updated_at=NOW() WHERE id=$1",
          [
            row.id,
            issues.codes.length === 1 &&
            issues.codes[0] === 'SPONSOR_REVIEW_REQUIRED'
              ? 'SPONSOR_REVIEW_REQUIRED'
              : 'SOURCE_NOT_ELIGIBLE'
          ]
        );
        await audit(db, 'publication-worker', 'source_invalidated', row.id, {
          codes: issues.codes,
          affected: issues.excludedSponsorIds
        });
        continue;
      }
      // Metadata is cheap to check before the due date. Bytes are still
      // re-read and hashed immediately before dispatch.
      const media = row.media_id
        ? await mediaRecord(db, row.media_id, row.batch_id)
        : null;
      const mediaCode = mediaSnapshotIssue(
        row.media_id,
        row.media_snapshot,
        media
      );
      if (mediaCode) {
        await db.query(
          "UPDATE publication_deliveries SET status='blocked',approved_at=NULL,approved_by=NULL,error_code=$2,version=version+1,updated_at=NOW() WHERE id=$1",
          [row.id, mediaCode]
        );
        await audit(db, 'publication-worker', 'media_invalidated', row.id, {
          code: mediaCode,
          mediaId: row.media_id
        });
        continue;
      }
    }
  });
}
