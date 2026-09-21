import type { Pool, PoolClient } from 'pg';

import {
  applyEditorialPreferences,
  type EditorialProfile,
  type PublicationFeedId
} from '../../../../packages/funding-core/src/index.js';

export async function editorialProfiles(
  db: Pool | PoolClient
): Promise<EditorialProfile[]> {
  const rows = (
    await db.query(
      `SELECT p.*,COALESCE((SELECT jsonb_object_agg(intent,n) FROM (SELECT intent,count(*)::int n FROM publication_editorial_observations o WHERE o.feed_id=p.feed_id GROUP BY intent) counts),'{}'::jsonb) observations FROM publication_editorial_profiles p ORDER BY feed_id`
    )
  ).rows;
  return rows.map((r) => ({
    feedId: r.feed_id,
    version: r.version,
    preferences: r.preferences,
    observations: r.observations
  }));
}

export async function editorialMessage(
  db: Pool | PoolClient,
  feed: PublicationFeedId,
  message: string,
  sponsorIds: string[] = []
): Promise<string> {
  // Old databases retain the existing preparation path until 025 is applied.
  const available = (
    await db.query(
      "SELECT to_regclass('public.publication_editorial_profiles') AS table_name"
    )
  ).rows[0]?.table_name;
  if (!available) return message;
  const row = (
    await db.query(
      'SELECT preferences FROM publication_editorial_profiles WHERE feed_id=$1',
      [feed]
    )
  ).rows[0];
  const names: string[] =
    row?.preferences?.includes('concise') && sponsorIds.length
      ? (
          await db.query(
            'SELECT sponsor_company_name FROM fund_contributions WHERE id=ANY($1::uuid[])',
            [sponsorIds]
          )
        ).rows
          .map((r) => r.sponsor_company_name)
          .filter(Boolean)
      : [];
  return applyEditorialPreferences(message, row?.preferences ?? [], names);
}
