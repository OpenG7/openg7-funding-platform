import type { AdminAttentionItem } from '@openg7/funding-core';
import type { Pool } from 'pg';

import { effectiveRefundsSql } from '../fund-refund-projection.js';
import { sponsorshipAdminUrl } from '../sponsorship-admin-presentation.js';
import {
  projectSponsorshipRefundProgress,
  type SponsorshipRefundProgressFacts
} from '../sponsorship-refund-progress.js';

interface RefundCandidate {
  readonly contributionId: string;
  readonly reference: string | null;
  readonly paymentStatus: string;
  readonly refundStatus: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly refundId: string | null;
  readonly refundAmountMinor: number | null;
  readonly refundError: boolean;
}
interface RefundFact {
  readonly contributionId: string;
  readonly kind: 'refund' | 'charge';
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
}
interface CreditFact {
  readonly contributionId: string;
  readonly refundId: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/** Shared dossier policy, applied to batched facts with no per-payment query. */
export const buildRefundFollowupItems = (
  candidates: readonly RefundCandidate[],
  facts: readonly RefundFact[],
  credits: readonly CreditFact[],
  now: Date
): AdminAttentionItem[] => {
  const refunds = new Map<
    string,
    SponsorshipRefundProgressFacts['refunds'][number][]
  >();
  const charges = new Map<
    string,
    SponsorshipRefundProgressFacts['charges'][number][]
  >();
  const documents = new Map<
    string,
    SponsorshipRefundProgressFacts['documents'][number][]
  >();
  for (const fact of facts) {
    const map = fact.kind === 'refund' ? refunds : charges;
    const list = map.get(fact.contributionId) ?? [];
    list.push(fact);
    map.set(fact.contributionId, list);
  }
  for (const credit of credits) {
    const list = documents.get(credit.contributionId) ?? [];
    list.push({ ...credit, kind: 'credit_note' });
    documents.set(credit.contributionId, list);
  }
  return candidates.flatMap((candidate) => {
    const refund = projectSponsorshipRefundProgress(candidate, {
      ...candidate,
      refunds: refunds.get(candidate.contributionId) ?? [],
      charges: charges.get(candidate.contributionId) ?? [],
      documents: documents.get(candidate.contributionId) ?? []
    });
    const types = [
      ...(refund.creditMissing ? ['sponsorship_credit_missing' as const] : []),
      ...(refund.hasError || refund.state === 'pending'
        ? ['sponsorship_refund_followup' as const]
        : [])
    ];
    return types.map((type) => ({
      id: `${type}:${candidate.contributionId}`,
      type,
      severity: refund.hasError ? ('urgent' as const) : ('today' as const),
      title: type,
      explanation: type,
      detectedAt: now.toISOString(),
      sponsorshipId: candidate.contributionId,
      contributionId: candidate.contributionId,
      adminUrl: sponsorshipAdminUrl(
        candidate.contributionId,
        type === 'sponsorship_credit_missing' ? 'billing' : 'refund'
      ),
      facts: {
        reference: candidate.reference ?? candidate.contributionId,
        workflow: candidate.refundStatus,
        confirmedAmountMinor: refund.confirmedAmountMinor,
        currency: candidate.currency.toUpperCase()
      },
      suggestedActions: [
        {
          actionType: 'open_sponsorship',
          label: 'Ouvrir le dossier',
          executionMode: 'navigate' as const
        }
      ]
    }));
  });
};

/** Financial history is read in three group queries; no provider call or private contact. */
export const loadRefundFollowupItems = async (
  pool: Pool,
  now: Date
): Promise<AdminAttentionItem[]> => {
  const [candidates, facts, credits] = await Promise.all([
    pool.query<RefundCandidate>(`SELECT id::text AS "contributionId",public_reference AS reference,status AS "paymentStatus",
      sponsorship_refund_status AS "refundStatus",currency,amount_cents AS "amountMinor",
      sponsorship_refund_id AS "refundId",sponsorship_refund_amount_cents AS "refundAmountMinor",
      COALESCE(sponsorship_refund_error <> '',false) AS "refundError"
      FROM fund_contributions WHERE contribution_type='sponsorship_interest' AND status IN ('paid','refunded','disputed')`),
    pool.query<RefundFact>(`WITH ${effectiveRefundsSql}, eligible AS (
      SELECT id,stripe_payment_intent_id FROM fund_contributions WHERE contribution_type='sponsorship_interest'
    ), confirmed_charge_events AS (
      SELECT c.id AS contribution_id,e.payload->'data'->'object' AS charge
      FROM eligible c JOIN stripe_events e ON COALESCE(e.payload->'data'->'object'->'payment_intent'->>'id',e.payload->'data'->'object'->>'payment_intent')=c.stripe_payment_intent_id
      WHERE e.event_type='charge.refunded' AND e.processing_status='processed'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(e.payload->'data'->'object'->'refunds'->'data','[]'::jsonb)) r
        WHERE r->>'status' IN ('pending','requires_action','failed','canceled'))
    )
    SELECT c.id::text AS "contributionId",'refund' AS kind,a.metadata->>'refundId' AS id,
      (a.metadata->>'amount')::integer AS amount,a.metadata->>'currency' AS currency
      FROM eligible c JOIN admin_audit_log a ON a.entity_type='sponsorship' AND a.entity_id=c.id::text
      WHERE a.action IN ('sponsorship_refund.stripe_full','sponsorship_refund.stripe_partial')
      AND a.metadata->>'refundStatus'='succeeded' AND a.metadata->>'refundId' IS NOT NULL
    UNION ALL SELECT c.id::text,'refund',r.metadata_json->>'refundId',r.amount::integer,r.currency
      FROM eligible c JOIN effective_refunds r ON r.metadata_json->>'paymentIntentId'=c.stripe_payment_intent_id
      WHERE r.metadata_json->>'refundId' IS NOT NULL
    UNION ALL SELECT c.id::text,'charge',r.stripe_object_id,sum(r.amount)::integer,r.currency
      FROM eligible c JOIN effective_refunds r ON r.metadata_json->>'paymentIntentId'=c.stripe_payment_intent_id
      GROUP BY c.id,r.stripe_object_id,r.currency
    UNION ALL SELECT contribution_id::text,'charge',charge->>'id',(charge->>'amount_refunded')::integer,charge->>'currency'
      FROM confirmed_charge_events
    UNION ALL SELECT contribution_id::text,'refund',r->>'id',(r->>'amount')::integer,r->>'currency'
      FROM confirmed_charge_events CROSS JOIN LATERAL jsonb_array_elements(COALESCE(charge->'refunds'->'data','[]'::jsonb)) r
      WHERE r->>'status'='succeeded'`),
    pool.query<CreditFact>(`SELECT n.contribution_id::text AS "contributionId",n.stripe_refund_id AS "refundId",
      n.total_cents AS "amountMinor",n.currency FROM sponsorship_credit_notes n
      JOIN fund_contributions c ON c.id=n.contribution_id WHERE c.contribution_type='sponsorship_interest'`)
  ]);
  return buildRefundFollowupItems(
    candidates.rows,
    facts.rows,
    credits.rows,
    now
  );
};
