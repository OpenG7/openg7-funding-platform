import { randomUUID } from 'node:crypto';

import { acceptanceSql } from './acceptance-database.js';

interface ParkedDraft {
  id: string;
  batch_id: string | null;
  slot_id: string | null;
  status: string;
  scheduled_at: string | null;
  draft_fingerprint: string;
  protected_fingerprint: string;
}

// These fingerprints include the existing facts, not a fabricated fulfilment.
// Only synthetic fixtures inside acceptanceSql's disposable stack are touched.
const protectedFingerprint = `md5(jsonb_build_object(
  'contribution',to_jsonb(c),
  'commitments',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM sponsorship_commitments m WHERE m.contribution_id=c.id),
  'obligations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM sponsorship_obligations o WHERE o.contribution_id=c.id),
  'evidence',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM sponsorship_fulfilment_evidence e WHERE e.contribution_id=c.id),
  'moderation',(SELECT jsonb_agg(to_jsonb(review) ORDER BY review.id) FROM moderation_cases review
    WHERE (review.subject_type='sponsorship' AND review.subject_id=c.id)
       OR (review.subject_type='publication_draft' AND review.subject_id=d.id))
)::text)`;

/** Reserve private, unassigned candidates so another scenario cannot recruit them. */
export async function parkAcceptancePublicationCandidates(
  excludedContributionIds: readonly string[]
): Promise<() => Promise<void>> {
  const parkingId = randomUUID();
  const [result] = await acceptanceSql<{ count: number; rows: ParkedDraft[] }>(
    `WITH candidates AS MATERIALIZED (
       SELECT d.id,d.batch_id,d.slot_id,d.status,d.scheduled_at,
         md5((to_jsonb(d)-'slot_id')::text) draft_fingerprint,
         ${protectedFingerprint} protected_fingerprint
       FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id
       WHERE d.feed_target='openg7' AND d.channel='facebook'
         AND d.batch_id IS NULL AND d.slot_id IS NULL AND d.status IN ('draft','approved')
         AND c.status='paid' AND c.public_display_consent AND c.sponsor_review_status IN ('pending_review','approved')
         AND c.sponsor_feed_status<>'hidden' AND NOT(c.id=ANY($1::uuid[]))
         AND NOT EXISTS(SELECT 1 FROM publication_deliveries p
           WHERE p.source_snapshot @> jsonb_build_array(jsonb_build_object('id',d.id)))
         AND NOT EXISTS(SELECT 1 FROM social_publication_jobs j WHERE d.id=ANY(j.draft_ids))
         AND NOT EXISTS(SELECT 1 FROM sponsorship_obligation_reservations r
           WHERE r.obligation_id=d.obligation_id AND r.released_at IS NULL)
         AND NOT EXISTS(SELECT 1 FROM moderation_cases review
           WHERE review.current_decision_id IS NOT NULL AND review.state<>'approved'
             AND ((review.subject_type='sponsorship' AND review.subject_id=c.id)
               OR (review.subject_type='publication_draft' AND review.subject_id=d.id)))
         AND EXISTS(SELECT 1 FROM sponsorship_obligations o JOIN sponsorship_commitments m ON m.id=o.commitment_id
           WHERE o.contribution_id=c.id AND m.state='active' AND o.state IN ('pending','blocked')
             AND o.target='openg7' AND o.channel='facebook')
       ORDER BY d.id LIMIT 101 FOR UPDATE OF d
     ), parking AS (
       INSERT INTO publication_slots(id,feed_target,channel,starts_at,capacity,notes)
       SELECT $2::uuid,'openg7','facebook',clock_timestamp()+INTERVAL '1 year',100,'Disposable recipe candidate isolation'
       WHERE (SELECT count(*) FROM candidates)<=100 RETURNING id
     ), parked AS (
       UPDATE sponsor_publication_drafts d SET slot_id=parking.id FROM candidates saved,parking
       WHERE d.id=saved.id RETURNING saved.*
     ) SELECT (SELECT count(*)::int FROM candidates) count,
       COALESCE((SELECT jsonb_agg(to_jsonb(parked) ORDER BY id) FROM parked),'[]'::jsonb) rows`,
    [excludedContributionIds, parkingId]
  );
  if (!result || result.count > 100 || result.rows.length !== result.count)
    throw new Error(
      'Candidate isolation exceeded its disposable fixture bound.'
    );

  return async () => {
    const restored = await acceptanceSql<{ id: string; intact: boolean }>(
      `WITH saved AS MATERIALIZED (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS original(
           id uuid,batch_id uuid,slot_id uuid,status text,scheduled_at timestamptz,
           draft_fingerprint text,protected_fingerprint text)
       ), locked AS MATERIALIZED (
         SELECT d.id,saved.draft_fingerprint,saved.protected_fingerprint,
           md5((to_jsonb(d)-'slot_id')::text)=saved.draft_fingerprint
             AND ${protectedFingerprint}=saved.protected_fingerprint intact
         FROM sponsor_publication_drafts d JOIN saved ON saved.id=d.id
         JOIN fund_contributions c ON c.id=d.contribution_id WHERE d.slot_id=$2::uuid FOR UPDATE OF d
       ), restored AS (
         UPDATE sponsor_publication_drafts d SET batch_id=saved.batch_id,slot_id=saved.slot_id,
           status=saved.status,scheduled_at=saved.scheduled_at
         FROM saved,locked WHERE d.id=saved.id AND locked.id=d.id RETURNING d.id,locked.intact
       ), removed AS (
         DELETE FROM publication_slots WHERE id=$2::uuid
           AND (SELECT count(*) FROM restored)=(SELECT count(*) FROM saved) RETURNING id
       ) SELECT id,intact FROM restored WHERE EXISTS(SELECT 1 FROM removed)`,
      [JSON.stringify(result.rows), parkingId]
    );
    if (
      restored.length !== result.rows.length ||
      restored.some((row) => !row.intact)
    )
      throw new Error(
        'Candidate isolation changed existing facts or did not restore every draft.'
      );
  };
}
