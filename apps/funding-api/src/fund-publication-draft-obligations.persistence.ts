import type { PoolClient } from 'pg';

/** Aliases are internal identifiers. The recorded agreement alone governs format grouping. */
export const publicationDraftFormatSql = (draft = 'd') =>
  `COALESCE((SELECT COALESCE(o.publication_format,'collective_text') FROM sponsorship_obligations o
    JOIN sponsorship_commitments agreement ON agreement.id=o.commitment_id
    WHERE agreement.state='active' AND o.contribution_id=${draft}.contribution_id
      AND o.channel=${draft}.channel AND o.target=${draft}.feed_target
      AND (${draft}.obligation_id=o.id OR (${draft}.obligation_id IS NULL AND o.state IN ('pending','blocked')))
    ORDER BY o.ordinal,o.id LIMIT 1),'collective_text')`;

export async function nextPublicationDraftObligation(
  db: Pick<PoolClient, 'query'>,
  contributionId: string,
  target: string,
  channel: string
): Promise<string | null> {
  return (
    (
      await db.query<{ id: string }>(
        `SELECT o.id FROM sponsorship_obligations o
    JOIN sponsorship_commitments a ON a.id=o.commitment_id
    WHERE a.state='active' AND o.contribution_id=$1::uuid AND o.target=$2 AND o.channel=$3
      AND o.state IN ('pending','blocked') ORDER BY o.ordinal,o.id LIMIT 1`,
        [contributionId, target, channel]
      )
    ).rows[0]?.id ?? null
  );
}
