import type { Pool } from 'pg';

import { normalizeSponsorMediaUsage } from '../../../../../packages/funding-core/src/index.js';

import type { AttentionMediaRecord } from './contracts.js';

/** Current private review facts only; no filenames, image bytes or contact data. */
export async function listSponsorshipMediaForAttention(
  pool: Pick<Pool, 'query'> | null,
  contributionIds?: readonly string[]
): Promise<readonly AttentionMediaRecord[]> {
  if (!pool) return [];
  const result = await pool.query<{
    contribution_id: string;
    changed_at: string;
    alt_text: string | null;
    usage_rights: unknown;
  }>(
    `SELECT a.contribution_id::text AS contribution_id,
      a.updated_at::text AS changed_at,
      a.alt_text,
      sponsor_media_effective_usage(a.id) AS usage_rights
    FROM sponsor_media_assets a JOIN fund_contributions c ON c.id=a.contribution_id
    WHERE a.deleted_at IS NULL AND a.review_status='pending_review'
      AND c.contribution_type='sponsorship_interest' AND c.status='paid'
      AND c.sponsorship_refund_status='not_requested' AND c.sponsor_review_status<>'rejected'
      AND ($1::uuid[] IS NULL OR a.contribution_id=ANY($1::uuid[]))
    ORDER BY a.contribution_id,a.updated_at,a.id`,
    [contributionIds ?? null]
  );
  return result.rows.flatMap((row) => {
    // Normalization validates the recorded scope; a missing platform receipt
    // must not invalidate genuine historical or inherited rights.
    const usage = normalizeSponsorMediaUsage(row.usage_rights);
    if (usage.state === 'withdrawn') return [];
    return [
      {
        contributionId: row.contribution_id,
        authorization:
          usage.state === 'confirmed'
            ? ('confirmed' as const)
            : ('required' as const),
        missingAlt: !row.alt_text?.trim(),
        changedAt: new Date(row.changed_at).toISOString()
      }
    ];
  });
}
