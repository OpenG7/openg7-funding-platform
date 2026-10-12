import type { PoolClient } from 'pg';

import {
  selectPublicationRecognitionSources,
  type PublicationRecognitionSource
} from '../../../packages/funding-core/src/index.js';

import { publicationDraftFormatSql } from './fund-publication-draft-obligations.persistence.js';

interface MembershipSource {
  readonly id: string;
  readonly contribution_id: string;
  readonly name: string | null;
  readonly title: string;
  readonly body: string;
  readonly disclosure_text: string;
  readonly feed_target: string;
  readonly channel: string;
  readonly batch_id: string | null;
  readonly batch_capacity: number | null;
  readonly publication_format: string;
  readonly batch_format: string | null;
}

export interface PublicationMembershipChange {
  readonly batchId?: string;
  readonly slotId?: string;
  readonly draftIds?: readonly string[];
  readonly incomingBatchId?: string;
}

/** Parent locks and the membership mutation must share the caller's transaction. */
export async function publicationMembershipFits(
  db: Pick<PoolClient, 'query'>,
  change: PublicationMembershipChange
): Promise<boolean> {
  const parent = change.slotId
    ? await db.query<{ capacity: number }>(
        'SELECT capacity FROM publication_slots WHERE id=$1::uuid',
        [change.slotId]
      )
    : await db.query<{ capacity: number }>(
        'SELECT capacity FROM sponsor_publication_batches WHERE id=$1::uuid',
        [change.batchId]
      );
  const capacity = parent.rows[0]?.capacity;
  if (!Number.isSafeInteger(capacity) || !capacity || capacity < 1)
    return false;

  // OR predicates retain one row per draft even when a batch and a direct slot
  // association describe the same member. No response-page limit applies here.
  const members = (
    await db.query<MembershipSource>(
      `SELECT d.id::text,d.contribution_id::text,c.sponsor_company_name AS name,
        d.title,d.body,d.disclosure_text,d.feed_target,d.channel,
        d.batch_id::text,b.capacity AS batch_capacity,${publicationDraftFormatSql()} AS publication_format,
        CASE WHEN $1::uuid IS NOT NULL THEN (SELECT target.publication_format FROM sponsor_publication_batches target WHERE target.id=$1::uuid)
          ELSE b.publication_format END AS batch_format
       FROM sponsor_publication_drafts d
       JOIN fund_contributions c ON c.id=d.contribution_id
       LEFT JOIN sponsor_publication_batches b ON b.id=d.batch_id
       WHERE ($1::uuid IS NOT NULL AND d.batch_id=$1::uuid)
          OR ($2::uuid IS NOT NULL AND (d.slot_id=$2::uuid OR b.slot_id=$2::uuid))
          OR d.id=ANY($3::uuid[])
          OR ($4::uuid IS NOT NULL AND d.batch_id=$4::uuid)
       ORDER BY d.created_at,d.id`,
      [
        change.batchId ?? null,
        change.slotId ?? null,
        change.draftIds ?? [],
        change.incomingBatchId ?? null
      ]
    )
  ).rows;
  if (members.length > capacity) return false;
  if (
    (change.draftIds ?? []).some(
      (id) => !members.some((member) => member.id === id)
    )
  )
    return false;

  // A slot can contain separately rendered batches. Its count is shared, while
  // the complete recognition budget applies to each final publication.
  const groups = new Map<string, MembershipSource[]>();
  for (const member of members) {
    const group = change.batchId ?? member.batch_id ?? 'direct';
    groups.set(group, [...(groups.get(group) ?? []), member]);
  }
  for (const group of groups.values()) {
    const first = group[0]!;
    const format = first.batch_format ?? first.publication_format;
    if (
      group.some(
        (member) =>
          member.publication_format !== format ||
          (member.batch_format && member.batch_format !== format)
      ) ||
      (format === 'individual_portrait' && group.length !== 1)
    )
      return false;
    if (
      group.some(
        (member) =>
          member.feed_target !== first.feed_target ||
          member.channel !== first.channel
      )
    )
      return false;
    const sources: PublicationRecognitionSource[] = group.map((member) => ({
      id: member.id,
      contributionId: member.contribution_id,
      name: member.name ?? '',
      title: member.title,
      body: member.body,
      disclosureText: member.disclosure_text
    }));
    const selected = selectPublicationRecognitionSources({
      existingSources: sources,
      candidates: [],
      capacity: change.batchId ? capacity : (first.batch_capacity ?? capacity)
    });
    if (selected.existingIssue) return false;
  }
  return true;
}
