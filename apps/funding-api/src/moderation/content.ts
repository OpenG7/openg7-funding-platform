import type { PoolClient } from 'pg';

import {
  isModerationSubject,
  type ModerationContent,
  type ModerationSubject
} from '../../../../packages/funding-core/src/index.js';

import { ModerationError } from './policy.js';

export type ModerationDb = Pick<PoolClient, 'query'>;
const tables = {
  sponsorship: 'fund_contributions',
  media: 'sponsor_media_assets',
  publication_draft: 'sponsor_publication_drafts',
  publication_delivery: 'publication_deliveries'
} as const;

/** Match the engine's delivery-before-source lock order for revocations. */
export async function lockModerationDependencies(
  db: ModerationDb,
  subject: ModerationSubject
): Promise<void> {
  if (!isModerationSubject(subject))
    throw new ModerationError('INVALID_MODERATION_SUBJECT', 400);
  const scope =
    subject.type === 'publication_delivery'
      ? 'p.id=$1'
      : subject.type === 'media'
        ? 'p.media_id=$1'
        : subject.type === 'publication_draft'
          ? 'p.batch_id IN (SELECT batch_id FROM sponsor_publication_drafts WHERE id=$1)'
          : 'p.batch_id IN (SELECT batch_id FROM sponsor_publication_drafts WHERE contribution_id=$1)';
  await db.query(
    `SELECT p.id FROM publication_deliveries p WHERE ${scope} ORDER BY p.id FOR UPDATE OF p`,
    [subject.id]
  );
}

/** Caller owns a transaction. Content locks precede case locks, like legacy writes. */
export async function getModerationContent(
  db: ModerationDb,
  subject: ModerationSubject
): Promise<ModerationContent> {
  if (!isModerationSubject(subject))
    throw new ModerationError('INVALID_MODERATION_SUBJECT', 400);
  const locked = await db.query(
    `SELECT id FROM ${tables[subject.type]} WHERE id=$1 FOR UPDATE`,
    [subject.id]
  );
  if (!locked.rows[0])
    throw new ModerationError('MODERATION_SUBJECT_NOT_FOUND', 404);
  const result = await db.query<{
    snapshot: Record<string, unknown> | null;
    fingerprint: string | null;
  }>(
    `SELECT snapshot,encode(digest(snapshot::text,'sha256'),'hex') AS fingerprint FROM (SELECT moderation_snapshot($1,$2) AS snapshot) s`,
    [subject.type, subject.id]
  );
  const { snapshot, fingerprint } = result.rows[0]!;
  if (!snapshot || !fingerprint)
    throw new ModerationError('MODERATION_SUBJECT_NOT_FOUND', 404);
  const contributionIds =
    subject.type === 'sponsorship'
      ? [subject.id]
      : subject.type === 'publication_delivery'
        ? [
            ...new Set(
              (snapshot.sources as { contributionId: string }[]).map(
                (source) => source.contributionId
              )
            )
          ]
        : typeof snapshot.contributionId === 'string'
          ? [snapshot.contributionId]
          : [];
  // A delivery decision may be shown to its sole sponsor from this immutable
  // snapshot. Collective deliveries have no sponsor-facing owner.
  const contributionId =
    contributionIds.length === 1 ? contributionIds[0]! : null;
  await db.query(
    `INSERT INTO moderation_cases(subject_type,subject_id,contribution_id) VALUES($1,$2,$3) ON CONFLICT(subject_type,subject_id) DO NOTHING`,
    // The mutable case must never assign a delivery's later composition to the
    // owner of an older decision. Ownership is captured on each decision.
    [
      subject.type,
      subject.id,
      subject.type === 'publication_delivery' ? null : contributionId
    ]
  );
  const current = (
    await db.query<{
      id: string;
      current_content_version: number;
      current_fingerprint: string | null;
      current_decision_id: string | null;
    }>(
      `SELECT id,current_content_version,current_fingerprint,current_decision_id FROM moderation_cases WHERE subject_type=$1 AND subject_id=$2 FOR UPDATE`,
      [subject.type, subject.id]
    )
  ).rows[0]!;
  let version = current.current_content_version;
  if (current.current_fingerprint !== fingerprint) {
    version += 1;
    await db.query(
      `INSERT INTO moderation_content_versions(subject_type,subject_id,content_version,content_fingerprint,snapshot,contribution_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        subject.type,
        subject.id,
        version,
        fingerprint,
        JSON.stringify(snapshot),
        contributionId
      ]
    );
    await db.query(
      `UPDATE moderation_cases SET current_content_version=$2,current_fingerprint=$3,state='unreviewed',updated_at=NOW() WHERE id=$1`,
      [current.id, version, fingerprint]
    );
  }
  return {
    subject,
    contributionId,
    contributionIds,
    contentVersion: version,
    fingerprint,
    snapshot,
    currentDecisionId: current.current_decision_id
  };
}
