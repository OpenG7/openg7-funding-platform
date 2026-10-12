import type {
  SponsorshipCommitmentAdoptionItem,
  SponsorshipCommitmentAdoptionPreview
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { isValidUuid } from '../business-helpers/request-validation.js';

import { SponsorshipCommitmentError } from './changes.js';

interface AdoptionRow extends Omit<
  SponsorshipCommitmentAdoptionItem,
  'classification'
> {
  readonly provenance: string | null;
}

/** Read one bounded owner page. Legacy publication declarations are never promoted to qualified proof. */
export const previewSponsorshipCommitmentAdoption = async (
  db: Pick<PoolClient, 'query'>,
  input: { pageSize?: number; cursor?: string | null } = {}
): Promise<SponsorshipCommitmentAdoptionPreview> => {
  const pageSize = input.pageSize ?? 25;
  if (
    ![25, 50, 100].includes(pageSize) ||
    (input.cursor != null && !isValidUuid(input.cursor))
  )
    throw new SponsorshipCommitmentError('COMMITMENT_INVALID', 400);
  const result = await db.query<AdoptionRow>(
    `WITH selected AS (
    SELECT id,public_reference,status,amount_cents,currency FROM fund_contributions
    WHERE contribution_type='sponsorship_interest' AND status IN ('paid','refunded','disputed')
      AND ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2
  ) SELECT c.id AS "contributionId",c.public_reference AS reference,c.status AS "paymentStatus",c.amount_cents AS "amountMinor",upper(c.currency) AS currency,
    m.id AS "commitmentId",m.provenance,o.version AS "offerVersion",
    (SELECT count(*)::integer FROM sponsorship_obligations ob WHERE ob.commitment_id=m.id) AS "obligationCount",
    (SELECT count(*)::integer FROM sponsorship_obligations ob WHERE ob.commitment_id=m.id AND ob.state='fulfilled' AND ob.fulfilment_evidence_id IS NOT NULL) AS "fulfilledWithEvidenceCount",
    (SELECT count(*)::integer FROM (
      SELECT 'draft:'||draft.id::text AS observation FROM sponsor_publication_drafts draft WHERE draft.contribution_id=c.id AND draft.status='published'
      UNION SELECT 'job:'||job.id::text FROM social_publication_jobs job WHERE job.status='published' AND EXISTS(
        SELECT 1 FROM sponsor_publication_drafts draft WHERE draft.contribution_id=c.id AND draft.id=ANY(job.draft_ids))
      UNION SELECT 'delivery:'||delivery.id::text FROM publication_deliveries delivery WHERE delivery.status='published' AND EXISTS(
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(delivery.source_snapshot)='array' THEN delivery.source_snapshot ELSE '[]'::jsonb END) source WHERE source->>'contribution_id'=c.id::text)
    ) declarations) AS "historicalDeclarationCount"
    FROM selected c LEFT JOIN sponsorship_commitments m ON m.contribution_id=c.id LEFT JOIN sponsorship_offers o ON o.id=m.offer_id
    ORDER BY c.id`,
    [input.cursor ?? null, pageSize + 1]
  );
  const hasMore = result.rows.length > pageSize;
  const items = result.rows
    .slice(0, pageSize)
    .map(({ provenance, ...row }): SponsorshipCommitmentAdoptionItem => ({
      ...row,
      classification:
        provenance === 'accepted_offer' && row.offerVersion
          ? 'accepted_snapshot'
          : provenance === 'qualified_historical' && row.offerVersion
            ? 'qualified_historical'
            : row.historicalDeclarationCount > 0
              ? 'legacy_declarations'
              : 'unqualified'
    }));
  return {
    items,
    pageSize,
    nextCursor: hasMore ? items.at(-1)!.contributionId : null
  };
};
