import type {
  SponsorshipCommitmentRecord,
  SponsorshipObligation,
  SponsorshipOfferSnapshot
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { moderationApprovedSql } from '../moderation/policy.js';
import { SPONSOR_APPROVED_PRESENTATION_SQL } from '../sponsorship-media-eligibility.js';
import { isValidUuid } from '../business-helpers/request-validation.js';

export const loadSponsorshipOfferForSession = async (
  db: Pick<PoolClient, 'query'>,
  stripeSessionId: string
): Promise<SponsorshipOfferSnapshot | null> => {
  const result = await db.query<{ snapshot: SponsorshipOfferSnapshot }>(
    `SELECT o.snapshot FROM fund_contributions c
    JOIN sponsorship_commitments m ON m.contribution_id=c.id JOIN sponsorship_offers o ON o.id=m.offer_id
    WHERE c.stripe_session_id=$1 LIMIT 1`,
    [stripeSessionId]
  );
  return result.rows[0]?.snapshot ?? null;
};

interface CommitmentRow extends Omit<
  SponsorshipCommitmentRecord,
  'obligations'
> {
  readonly blockedReason: string | null;
}

/** Read commercial history separately from current eligibility; completed evidence remains history. */
export const loadSponsorshipCommitment = async (
  db: Pick<PoolClient, 'query'>,
  contributionId: string
): Promise<SponsorshipCommitmentRecord | null> => {
  const result = await db.query<CommitmentRow>(
    `SELECT m.id,m.contribution_id AS "contributionId",m.offer_id AS "offerId",m.provenance,m.state,
    m.qualification_reason AS "qualificationReason",m.version,o.snapshot AS offer,
    CASE WHEN c.status <> 'paid' THEN 'payment_' || c.status
      WHEN c.sponsorship_refund_status <> 'not_requested' THEN 'refund_' || c.sponsorship_refund_status
      WHEN NOT c.public_display_consent THEN 'consent_missing'
      WHEN c.sponsor_review_status <> 'approved' THEN 'review_' || c.sponsor_review_status
      WHEN NOT (${moderationApprovedSql('sponsorship', 'c.id')}) THEN 'moderation_review_required'
      ELSE NULL END AS "blockedReason"
    FROM sponsorship_commitments m JOIN fund_contributions c ON c.id=m.contribution_id
    LEFT JOIN sponsorship_offers o ON o.id=m.offer_id WHERE m.contribution_id=$1::uuid`,
    [contributionId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const obligations = await db.query<
    SponsorshipObligation & { requirementsMet: boolean }
  >(
    `SELECT ob.id,ob.commitment_id AS "commitmentId",ob.contribution_id AS "contributionId",
    ob.benefit_id AS "benefitId",ob.channel,ob.target,ob.publication_format AS format,ob.ordinal,ob.state,ob.blocked_reason AS "blockedReason",ob.version,ob.fulfilment_evidence_id AS "fulfilmentEvidenceId",
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(o.snapshot->'benefits') b CROSS JOIN LATERAL jsonb_array_elements_text(b->'requiredElements') requirement
      WHERE b->>'id'=ob.benefit_id AND (
        (requirement='company_name' AND NULLIF(btrim(c.sponsor_company_name),'') IS NULL) OR
        (requirement='approved_presentation' AND NOT (${SPONSOR_APPROVED_PRESENTATION_SQL.replaceAll('fund_contributions.id', 'c.id')})) OR
        (requirement='approved_logo' AND NOT EXISTS(SELECT 1 FROM sponsor_media_assets media
          WHERE media.contribution_id=c.id AND media.deleted_at IS NULL AND media.review_status='approved'
            AND media.kind='logo' AND ${moderationApprovedSql('media', 'media.id')})))) AS "requirementsMet"
    FROM sponsorship_obligations ob JOIN sponsorship_commitments m ON m.id=ob.commitment_id
    JOIN sponsorship_offers o ON o.id=m.offer_id JOIN fund_contributions c ON c.id=ob.contribution_id
    WHERE ob.commitment_id=$1::uuid ORDER BY ob.channel,ob.target,ob.ordinal,ob.id`,
    [row.id]
  );
  const { blockedReason, ...commitment } = row;
  return {
    ...commitment,
    obligations: obligations.rows.map(({ requirementsMet, ...o }) => {
      const reason =
        blockedReason ?? (requirementsMet ? null : 'required_elements_missing');
      return ['fulfilled', 'adjusted'].includes(o.state)
        ? o
        : {
            ...o,
            state: reason ? 'blocked' : o.state,
            blockedReason: reason ?? o.blockedReason
          };
    })
  };
};

export const createSponsorshipObligations = async (
  db: PoolClient,
  commitmentId: string,
  contributionId: string,
  snapshot: SponsorshipOfferSnapshot
): Promise<void> => {
  for (const benefit of snapshot.benefits) {
    await db.query(
      `INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal,publication_format)
      SELECT $1::uuid,$2::uuid,$3,$4,$5,n,$7 FROM generate_series(1,$6::integer) n
      ON CONFLICT(commitment_id,benefit_id,ordinal) DO NOTHING`,
      [
        commitmentId,
        contributionId,
        benefit.id,
        benefit.channel,
        benefit.target,
        benefit.quantity,
        benefit.format ?? null
      ]
    );
  }
};

/** Called inside the financial write transaction after server-confirmed paid state. */
export const activateSponsorshipCommitments = async (
  db: PoolClient,
  input: {
    readonly stripeSessionId?: string | null;
    readonly stripePaymentIntentId?: string | null;
  }
): Promise<void> => {
  const contributions = await db.query<{
    id: string;
    public_reference: string | null;
    amount_cents: number;
    currency: string;
    metadata: Record<string, string>;
  }>(
    `SELECT c.id,c.public_reference,c.amount_cents,c.currency,COALESCE(s.metadata,'{}'::jsonb) AS metadata
    FROM fund_contributions c LEFT JOIN stripe_checkout_sessions s ON s.stripe_session_id=c.stripe_session_id
    WHERE c.contribution_type='sponsorship_interest' AND c.status IN ('paid','refunded','disputed') AND c.paid_at IS NOT NULL
      AND (($1::text IS NOT NULL AND c.stripe_session_id=$1) OR ($2::text IS NOT NULL AND c.stripe_payment_intent_id=$2))
    ORDER BY c.id FOR UPDATE OF c`,
    [input.stripeSessionId ?? null, input.stripePaymentIntentId ?? null]
  );
  for (const c of contributions.rows) {
    const operationId =
      c.metadata.openg7CheckoutOperationId ?? c.metadata.checkoutOperationId;
    const offerResult =
      operationId && isValidUuid(operationId)
        ? await db.query<{ id: string; snapshot: SponsorshipOfferSnapshot }>(
            `SELECT id,snapshot FROM sponsorship_offers
        WHERE checkout_operation_id=$1::uuid AND public_reference=$2 AND amount_minor=$3 AND currency=$4`,
            [
              operationId,
              c.public_reference,
              c.amount_cents,
              c.currency.toUpperCase()
            ]
          )
        : null;
    const offer = offerResult?.rows[0];
    const commitment = await db.query<{ id: string; offer_id: string | null }>(
      `INSERT INTO sponsorship_commitments(contribution_id,offer_id,provenance,state,qualification_reason,activated_at)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,CASE WHEN $2::uuid IS NOT NULL THEN NOW() END)
      ON CONFLICT(contribution_id) DO UPDATE SET
        offer_id=CASE WHEN sponsorship_commitments.state='needs_confirmation' AND EXCLUDED.offer_id IS NOT NULL THEN EXCLUDED.offer_id ELSE sponsorship_commitments.offer_id END,
        provenance=CASE WHEN sponsorship_commitments.state='needs_confirmation' AND EXCLUDED.offer_id IS NOT NULL THEN EXCLUDED.provenance ELSE sponsorship_commitments.provenance END,
        state=CASE WHEN sponsorship_commitments.state='needs_confirmation' AND EXCLUDED.offer_id IS NOT NULL THEN EXCLUDED.state ELSE sponsorship_commitments.state END,
        qualification_reason=CASE WHEN sponsorship_commitments.state='needs_confirmation' AND EXCLUDED.offer_id IS NOT NULL THEN NULL ELSE sponsorship_commitments.qualification_reason END,
        activated_at=COALESCE(sponsorship_commitments.activated_at,EXCLUDED.activated_at),
        version=sponsorship_commitments.version+CASE WHEN sponsorship_commitments.state='needs_confirmation' AND EXCLUDED.offer_id IS NOT NULL THEN 1 ELSE 0 END,
        updated_at=NOW()
      RETURNING id,offer_id`,
      [
        c.id,
        offer?.id ?? null,
        offer ? 'accepted_offer' : 'historical_unverified',
        offer ? 'active' : 'needs_confirmation',
        offer
          ? null
          : operationId
            ? 'offer_correlation_unconfirmed'
            : 'historical_offer_not_recorded'
      ]
    );
    const m = commitment.rows[0]!;
    if (offer && m.offer_id === offer.id)
      await createSponsorshipObligations(db, m.id, c.id, offer.snapshot);
  }
};
