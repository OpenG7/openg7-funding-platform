import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';
import type { PublicationFeedId } from '@openg7/funding-core';

import { selectPublicationRecognitionSources } from '../../../../packages/funding-core/src/index.js';

import { assert } from './policy.js';
import {
  eligibleDestination,
  recognitionSource,
  preparationEligibilitySql,
  currentBlockedSourceSql,
  PREPARATION_SCAN_LIMIT
} from './preparation-sources.js';

export { eligibleDestination } from './preparation-sources.js';

export type Db = Pool | PoolClient;
export interface Source {
  id: string;
  contribution_id: string;
  title: string;
  body: string;
  disclosure_text: string;
  feed_target: string;
  channel: string;
}

export const sourceEqual = (a: Source[], b: Source[]) =>
  isDeepStrictEqual(a, b);
export const sourceMessage = (sources: Source[]) =>
  sources
    .map((s) =>
      [s.title, s.body, s.disclosure_text].filter(Boolean).join('\n\n')
    )
    .join('\n\n');

/** Current source facts, also used by preflight before an authorized send is due. */
export async function sourceIssues(
  db: Db,
  id: string
): Promise<{ codes: string[]; excludedSponsorIds: string[] }> {
  const rows = (
    await db.query(
      `SELECT c.id,c.status,c.public_display_consent,c.sponsor_review_status,c.sponsor_feed_status,
          (d.status IN ('approved','publishing') AND
            (c.sponsor_review_status = 'pending_review' OR c.sponsor_details_submitted_at > d.approved_at)) AS review_changed,
          (${eligibleDestination('c', 's.feed_target', 's.channel')}) destination_eligible
         FROM publication_deliveries d JOIN sponsor_publication_drafts s ON s.batch_id=d.batch_id
         JOIN fund_contributions c ON c.id=s.contribution_id WHERE d.id=$1`,
      [id]
    )
  ).rows;
  const codes = new Set<string>();
  const excludedSponsorIds: string[] = [];
  for (const r of rows) {
    const invalid =
      r.status !== 'paid' ||
      !r.public_display_consent ||
      r.sponsor_review_status === 'rejected' ||
      r.review_changed ||
      r.sponsor_feed_status === 'hidden' ||
      !r.destination_eligible;
    if (!invalid) continue;
    excludedSponsorIds.push(r.id);
    if (r.status !== 'paid') codes.add('PAYMENT_REQUIRED');
    if (!r.public_display_consent) codes.add('CONSENT_WITHDRAWN');
    if (r.review_changed) codes.add('SPONSOR_REVIEW_REQUIRED');
    if (
      r.sponsor_review_status === 'rejected' ||
      r.sponsor_feed_status === 'hidden'
    )
      codes.add('SOURCE_NOT_ELIGIBLE');
    if (!r.destination_eligible) codes.add('DESTINATION_CHANGED');
  }
  return {
    codes: [...codes].sort(),
    excludedSponsorIds: excludedSponsorIds.sort()
  };
}

export async function repairSources(
  db: Db,
  row: { batch_id: string | null; feed_id: PublicationFeedId }
): Promise<(Source & { name: string })[]> {
  const batch = (
    await db.query(
      'SELECT capacity FROM sponsor_publication_batches WHERE id=$1',
      [row.batch_id]
    )
  ).rows[0];
  if (!batch) return [];
  const [target, channel] = row.feed_id.split(':');
  const existing = (
    await db.query(
      `SELECT d.id,d.contribution_id,d.title,d.body,d.disclosure_text,d.feed_target,d.channel,c.sponsor_company_name AS name
       FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id
       WHERE d.batch_id=$1 AND ${preparationEligibilitySql('d', 'c', '$2', '$3')}
       ORDER BY d.id`,
      [row.batch_id, target, channel]
    )
  ).rows as (Source & { name: string })[];
  const candidates = (
    await db.query(
      `SELECT d.id,d.contribution_id,d.title,d.body,d.disclosure_text,d.feed_target,d.channel,c.sponsor_company_name AS name
       FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id
       WHERE d.batch_id IS NULL AND d.slot_id IS NULL
         AND d.status IN ('draft','approved')
         AND ${preparationEligibilitySql('d', 'c', '$1', '$2')}
         AND NOT ${currentBlockedSourceSql()}
       ORDER BY d.created_at,d.id LIMIT $3`,
      [target, channel, PREPARATION_SCAN_LIMIT]
    )
  ).rows as (Source & { name: string })[];
  const selected = selectPublicationRecognitionSources({
    existingSources: existing.map(recognitionSource),
    candidates: candidates.map(recognitionSource),
    capacity: batch.capacity
  });
  // A repair recipe must keep every eligible existing member intact. An invalid
  // retained base requires a source correction, not a proposal that cannot apply.
  if (selected.existingIssue) return [];
  const retained = new Set(selected.retained.map((source) => source.id));
  return [...existing, ...candidates].filter((source) =>
    retained.has(source.id)
  );
}

export async function sources(
  db: Db,
  batchId: string,
  feedId: PublicationFeedId,
  allowPending = false
): Promise<Source[]> {
  const batch = (
    await db.query(
      `SELECT * FROM sponsor_publication_batches WHERE id=$1 FOR UPDATE`,
      [batchId]
    )
  ).rows[0];
  assert(
    batch && ['open', 'scheduled'].includes(batch.status),
    'BATCH_UNAVAILABLE'
  );
  assert(
    !(
      await db.query(
        `SELECT 1 FROM social_publication_jobs WHERE batch_id=$1 AND status IN ('publishing','published','failed')`,
        [batchId]
      )
    ).rowCount,
    'LEGACY_DELIVERY_EXISTS'
  );
  const all = (
    await db.query(
      `SELECT d.id,d.contribution_id,d.title,d.body,d.disclosure_text,d.feed_target,d.channel,d.status,c.sponsor_feed_status,c.public_display_consent,c.sponsor_review_status,c.status AS payment_status,(${eligibleDestination('c', 'd.feed_target', 'd.channel')}) AS destination_eligible FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id WHERE d.batch_id=$1 ORDER BY d.id FOR UPDATE OF d,c`,
      [batchId]
    )
  ).rows;
  assert(all.length > 0 && all.length <= batch.capacity, 'EMPTY_BATCH');
  assert(
    all.every(
      (d) =>
        `${d.feed_target}:${d.channel}` === feedId &&
        ['draft', 'approved', 'scheduled'].includes(d.status) &&
        d.public_display_consent &&
        (d.sponsor_review_status === 'approved' ||
          (allowPending && d.sponsor_review_status === 'pending_review')) &&
        d.destination_eligible &&
        d.payment_status === 'paid' &&
        d.sponsor_feed_status !== 'hidden'
    ),
    'SOURCE_NOT_ELIGIBLE'
  );
  return all.map(
    ({
      id,
      contribution_id,
      title,
      body,
      disclosure_text,
      feed_target,
      channel
    }) => ({
      id,
      contribution_id,
      title,
      body,
      disclosure_text,
      feed_target,
      channel
    })
  );
}
