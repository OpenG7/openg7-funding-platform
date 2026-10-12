import type { ProgrammeIssue } from '@openg7/funding-core';

import { isValidPublicationMessage } from '../../../../packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import { lockPublicationBatchCapacity } from '../fund-publication-capacity.persistence.js';
import { publicationMembershipFits } from '../fund-publication-rendering.persistence.js';

import {
  audit,
  type DeliveryRow,
  type PublicationPlanningContext
} from './context.js';
import { composeSponsorshipContent } from './content.js';
import { assert, digest, recurrenceTimes } from './policy.js';
import { type Db, sourceIssues, repairSources } from './sources.js';

export async function repairPreview(
  context: PublicationPlanningContext,
  id: string,
  db: Db = context.pool
): Promise<ProgrammeIssue['repair']> {
  const row = (
    await db.query<DeliveryRow>(
      'SELECT * FROM publication_deliveries WHERE id=$1',
      [id]
    )
  ).rows[0];
  if (!row?.batch_id || !['draft', 'approved', 'blocked'].includes(row.status))
    return null;
  // Legacy or ambiguous external deliveries always stay in the investigation path.
  if (
    (
      await db.query(
        "SELECT 1 FROM social_publication_jobs WHERE batch_id=$1 AND status IN ('publishing','published','failed')",
        [row.batch_id]
      )
    ).rowCount
  )
    return null;
  const issues = await sourceIssues(db, id);
  if (!issues.excludedSponsorIds.length) return null;
  const candidates = await repairSources(db, row);
  if (!candidates.length) return null;
  const feed = (await context.feeds(db)).find((f) => f.id === row.feed_id)!;
  const scheduledAt =
    row.scheduled_at.getTime() > Date.now()
      ? row.scheduled_at.toISOString()
      : recurrenceTimes(feed, new Date())[0];
  if (!scheduledAt) return null;
  let message = await composeSponsorshipContent(db, row.feed_id, candidates);
  // Keep previously rendered credits for retained photographs. The delegated
  // edit still verifies the current rights and exact asset versions.
  const retainedIds = new Set(
    candidates.map((source) => source.contribution_id)
  );
  const mediaCredits =
    row.media_snapshot?.kind === 'derived'
      ? row.media_snapshot.sources
          .filter((source) => retainedIds.has(source.contributionId))
          .map((source) => source.media.usage.credit)
      : [];
  if (
    row.media_id &&
    row.media_snapshot?.kind !== 'derived' &&
    row.media_snapshot &&
    (
      await db.query(
        "SELECT 1 FROM sponsor_media_assets WHERE id=$1 AND contribution_id=ANY($2::uuid[]) AND deleted_at IS NULL AND review_status='approved'",
        [row.media_id, [...retainedIds]]
      )
    ).rowCount
  )
    mediaCredits.push(row.media_snapshot.usage.credit);
  for (const credit of new Set(mediaCredits)) {
    if (
      credit &&
      row.message.split('\n').some((line) => line.trim() === credit) &&
      !message.split('\n').some((line) => line.trim() === credit)
    )
      message += `\n\n${credit}`;
  }
  if (!isValidPublicationMessage(message)) return null;
  const original = (
    await db.query(
      'SELECT contribution_id FROM sponsor_publication_drafts WHERE batch_id=$1',
      [row.batch_id]
    )
  ).rows.map((r) => r.contribution_id as string);
  const sponsors = candidates.map((c) => ({
    id: c.contribution_id,
    name: c.name
  }));
  return {
    version: digest(
      JSON.stringify({
        v: row.version,
        candidates,
        message,
        scheduledAt,
        issues
      })
    ),
    message,
    scheduledAt,
    sponsors,
    removed: original.filter((id) => !sponsors.some((s) => s.id === id)),
    added: sponsors.filter((s) => !original.includes(s.id)).map((s) => s.id)
  };
}

export async function repair(
  context: PublicationPlanningContext,
  id: string,
  version: string,
  actor: string
): Promise<void> {
  await withPostgresTransaction(context.pool, async (db) => {
    const feed = (
      await db.query('SELECT feed_id FROM publication_deliveries WHERE id=$1', [
        id
      ])
    ).rows[0]?.feed_id;
    assert(feed, 'VERSION_CONFLICT');
    await db.query('SELECT id FROM publication_feeds WHERE id=$1 FOR UPDATE', [
      feed
    ]);
    const row = (
      await db.query<DeliveryRow>(
        'SELECT * FROM publication_deliveries WHERE id=$1 FOR UPDATE',
        [id]
      )
    ).rows[0]!;
    assert(
      await lockPublicationBatchCapacity(db, row.batch_id!),
      'BATCH_UNAVAILABLE'
    );
    await db.query(
      'SELECT id FROM sponsor_publication_batches WHERE id=$1 FOR UPDATE',
      [row.batch_id]
    );
    // Lock eligible and excluded contribution facts before recalculating the proposal.
    await db.query(
      `SELECT c.id FROM fund_contributions c JOIN sponsor_publication_drafts d ON d.contribution_id=c.id WHERE d.batch_id=$1 OR (d.batch_id IS NULL AND d.feed_target=$2 AND d.channel=$3) ORDER BY c.id,d.id FOR UPDATE OF d,c`,
      [row.batch_id, ...row.feed_id.split(':')]
    );
    const proposal = await repairPreview(context, id, db);
    assert(proposal && proposal.version === version, 'VERSION_CONFLICT');
    const candidates = await repairSources(db, row);
    await db.query(
      "UPDATE sponsor_publication_drafts SET batch_id=NULL,slot_id=NULL,scheduled_at=NULL,status='draft',approved_at=NULL,updated_at=NOW() WHERE batch_id=$1",
      [row.batch_id]
    );
    for (const c of candidates)
      await db.query(
        "UPDATE sponsor_publication_drafts SET batch_id=$2,scheduled_at=$3,status='draft',approved_at=NULL,updated_at=NOW() WHERE id=$1",
        [c.id, row.batch_id, proposal.scheduledAt]
      );
    await db.query(
      "UPDATE sponsor_publication_batches SET status='open',scheduled_at=$2,updated_at=NOW() WHERE id=$1",
      [row.batch_id, proposal.scheduledAt]
    );
    assert(
      await publicationMembershipFits(db, { batchId: row.batch_id! }),
      'BATCH_CAPACITY_EXCEEDED'
    );
    const slotId = (
      await db.query<{ slot_id: string | null }>(
        'SELECT slot_id::text AS slot_id FROM sponsor_publication_batches WHERE id=$1::uuid',
        [row.batch_id]
      )
    ).rows[0]?.slot_id;
    assert(
      !slotId || (await publicationMembershipFits(db, { slotId })),
      'SLOT_CAPACITY_EXCEEDED'
    );
    // Recompose from retained source facts; a media from an excluded sponsor is removed.
    const keepMedia =
      row.media_id &&
      (
        await db.query(
          "SELECT 1 FROM sponsor_media_assets WHERE id=$1 AND contribution_id=ANY($2::uuid[]) AND deleted_at IS NULL AND review_status='approved'",
          [row.media_id, proposal.sponsors.map((s) => s.id)]
        )
      ).rowCount;
    await context.command(
      {
        action: 'edit',
        id,
        version: row.version,
        message: proposal.message,
        scheduledAt: proposal.scheduledAt,
        mediaId: keepMedia ? row.media_id : null,
        ...(row.publication_format &&
        row.publication_format !== 'collective_text'
          ? {
              publicationFormat: row.publication_format,
              photoSelections: (row.photo_selections ?? []).filter((photo) =>
                proposal.sponsors.some(
                  (sponsor) => sponsor.id === photo.contributionId
                )
              )
            }
          : {})
      },
      actor,
      false,
      db
    );
    await audit(db, actor, 'repair_proposed', id, {
      removed: proposal.removed,
      added: proposal.added,
      approval: 'required'
    });
  });
}
