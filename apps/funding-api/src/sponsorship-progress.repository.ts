import type {
  AdminSponsorshipProgress,
  SponsorshipProgressDocument,
  SponsorshipProgressPublication
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { effectiveRefundsSql } from './fund-refund-projection.js';
import { SPONSOR_WEBSITE_VISIBLE_SQL } from './sponsorship-website-eligibility.js';

export interface SponsorshipRefundFact {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
}
/** Persisted inputs for the progress projection; this model grants no action. */
export interface SponsorshipProgressFacts {
  readonly websiteVisible: boolean;
  readonly websiteHeld: boolean;
  readonly websiteVersion: string;
  readonly companyName: string | null;
  readonly amountMinor: number;
  readonly refundId: string | null;
  readonly refundAmountMinor: number | null;
  readonly refundError: boolean;
  readonly requiresInvoice: boolean;
  readonly documents: readonly (SponsorshipProgressDocument & {
    readonly refundId?: string;
  })[];
  readonly publications: readonly SponsorshipProgressPublication[];
  readonly refunds: readonly SponsorshipRefundFact[];
  readonly charges: readonly SponsorshipRefundFact[];
  readonly failedEmails: AdminSponsorshipProgress['failedEmails'];
  readonly failedStripeEvents: AdminSponsorshipProgress['failedStripeEvents'];
}

interface StripeRefundRow extends SponsorshipRefundFact {
  readonly refunds: readonly SponsorshipRefundFact[];
}

/** Read sequentially on the caller's dossier snapshot; keep provider payloads private. */
export const loadSponsorshipProgressFacts = async (
  client: PoolClient,
  id: string
): Promise<SponsorshipProgressFacts> => {
  const details = await client.query<
    Pick<
      SponsorshipProgressFacts,
      | 'companyName'
      | 'amountMinor'
      | 'refundId'
      | 'refundAmountMinor'
      | 'refundError'
      | 'requiresInvoice'
      | 'websiteVisible'
      | 'websiteHeld'
      | 'websiteVersion'
    >
  >(
    `SELECT
    (${SPONSOR_WEBSITE_VISIBLE_SQL}) AS "websiteVisible", sponsor_site_visibility_held AS "websiteHeld", updated_at::text AS "websiteVersion",
    sponsor_company_name AS "companyName", amount_cents AS "amountMinor", sponsorship_refund_id AS "refundId",
    sponsorship_refund_amount_cents AS "refundAmountMinor", COALESCE(sponsorship_refund_error <> '', false) AS "refundError", stripe_session_id IS NOT NULL AS "requiresInvoice"
    FROM fund_contributions WHERE id = $1::uuid`,
    [id]
  );
  const documents = await client.query<
    SponsorshipProgressFacts['documents'][number]
  >(
    `SELECT id, invoice_number AS number, 'invoice' AS kind,
    total_cents AS "amountMinor", currency, issued_at::text AS "issuedAt", NULL AS "refundId" FROM sponsorship_invoices WHERE contribution_id = $1::uuid
    UNION ALL SELECT id, credit_note_number, 'credit_note', total_cents, currency, issued_at::text, stripe_refund_id
    FROM sponsorship_credit_notes WHERE contribution_id = $1::uuid ORDER BY "issuedAt", id`,
    [id]
  );
  const publications = await client.query<SponsorshipProgressPublication>(
    `SELECT d.id, d.channel, d.feed_target AS target, d.status,
    b.status AS "batchStatus", s.status AS "slotStatus",
    CASE WHEN a.id IS NOT NULL THEN a.status ELSE j.status END AS "deliveryStatus",
    CASE WHEN a.id IS NOT NULL THEN a.mode ELSE j.mode END AS "deliveryMode",
    a.id AS "deliveryId", a.error_code AS "deliveryError", f.paused AS "feedPaused",
    COALESCE(d.public_url, CASE WHEN a.mode = 'live' AND a.status = 'published' THEN a.external_post_url END) AS "publicUrl",
    COALESCE(a.scheduled_at, d.scheduled_at, s.starts_at, b.scheduled_at)::text AS "scheduledAt",
    COALESCE(d.published_at, CASE WHEN a.mode = 'live' AND a.status = 'published' THEN a.published_at END)::text AS "publishedAt"
    FROM sponsor_publication_drafts d LEFT JOIN sponsor_publication_batches b ON b.id = d.batch_id
    LEFT JOIN publication_slots s ON s.id = COALESCE(d.slot_id, b.slot_id)
    LEFT JOIN LATERAL (SELECT status, mode FROM social_publication_jobs WHERE d.id = ANY(draft_ids) ORDER BY updated_at DESC, id LIMIT 1) j ON true
    LEFT JOIN LATERAL (SELECT * FROM publication_deliveries WHERE batch_id = d.batch_id
      AND feed_id = d.feed_target || ':' || d.channel
      ORDER BY (status = 'published' AND mode = 'live') DESC,
      (status NOT IN ('cancelled', 'rejected')) DESC, updated_at DESC, id LIMIT 1) a ON true
    LEFT JOIN publication_feeds f ON f.id = d.feed_target || ':' || d.channel
    WHERE d.contribution_id = $1::uuid ORDER BY d.channel, d.feed_target`,
    [id]
  );
  const auditRefunds = await client.query<SponsorshipRefundFact>(
    `SELECT metadata->>'refundId' AS id, (metadata->>'amount')::integer AS amount, metadata->>'currency' AS currency
    FROM admin_audit_log WHERE entity_type = 'sponsorship' AND entity_id = $1 AND action IN ('sponsorship_refund.stripe_full', 'sponsorship_refund.stripe_partial')
    AND metadata->>'refundStatus' = 'succeeded' AND metadata->>'refundId' IS NOT NULL`,
    [id]
  );
  // Only processed Stripe facts, matched to this contribution; never expose raw payloads.
  const stripeRefunds = await client.query<StripeRefundRow>(
    `WITH ${effectiveRefundsSql}
    SELECT
    e.payload->'data'->'object'->>'id' AS id, (e.payload->'data'->'object'->>'amount_refunded')::integer AS amount,
    e.payload->'data'->'object'->>'currency' AS currency,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r->>'id', 'amount', (r->>'amount')::integer, 'currency', r->>'currency'))
      FROM jsonb_array_elements(COALESCE(e.payload->'data'->'object'->'refunds'->'data', '[]'::jsonb)) r WHERE r->>'status' = 'succeeded'), '[]'::jsonb) AS refunds
    FROM stripe_events e JOIN fund_contributions c ON c.id = $1::uuid
    WHERE e.event_type = 'charge.refunded' AND e.processing_status = 'processed'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(e.payload->'data'->'object'->'refunds'->'data','[]'::jsonb)) refund
      WHERE refund->>'status' IN ('pending','requires_action','failed','canceled'))
    AND COALESCE(e.payload->'data'->'object'->'payment_intent'->>'id', e.payload->'data'->'object'->>'payment_intent') = c.stripe_payment_intent_id
    UNION ALL
    SELECT r.stripe_object_id,sum(r.amount)::integer,r.currency,
      COALESCE(jsonb_agg(jsonb_build_object('id',r.metadata_json->>'refundId','amount',r.amount::integer,'currency',r.currency))
        FILTER (WHERE r.metadata_json->>'refundId' IS NOT NULL),'[]'::jsonb)
    FROM effective_refunds r JOIN fund_contributions c ON c.id=$1::uuid
    WHERE r.metadata_json->>'paymentIntentId'=c.stripe_payment_intent_id
    GROUP BY r.stripe_object_id,r.currency`,
    [id]
  );
  const failedEmails = await client.query<{ id: string; template: string }>(
    `SELECT id, template_key AS template FROM email_messages
    WHERE status = 'failed' AND (metadata->>'contributionId' = $1 OR metadata->>'invoiceId' IN (SELECT id::text FROM sponsorship_invoices WHERE contribution_id = $1::uuid)
    OR metadata->>'creditNoteId' IN (SELECT id::text FROM sponsorship_credit_notes WHERE contribution_id = $1::uuid)) ORDER BY created_at DESC`,
    [id]
  );
  const failedStripeEvents = await client.query<{ id: string; type: string }>(
    `SELECT e.stripe_event_id AS id, e.event_type AS type
    FROM stripe_events e JOIN fund_contributions c ON c.id = $1::uuid WHERE e.processing_status = 'failed'
    AND (e.payload->'data'->'object'->>'id' IN (c.stripe_payment_intent_id, c.stripe_session_id)
      OR COALESCE(e.payload->'data'->'object'->'payment_intent'->>'id', e.payload->'data'->'object'->>'payment_intent') = c.stripe_payment_intent_id)`,
    [id]
  );
  return {
    ...details.rows[0]!,
    documents: documents.rows,
    publications: publications.rows,
    refunds: [
      ...auditRefunds.rows,
      ...stripeRefunds.rows.flatMap((r) => r.refunds)
    ],
    charges: stripeRefunds.rows.map(({ id, amount, currency }) => ({
      id,
      amount,
      currency
    })),
    failedEmails: failedEmails.rows,
    failedStripeEvents: failedStripeEvents.rows
  };
};

export const findSponsorshipPreparationActivityId = async (
  client: PoolClient,
  contributionId: string
): Promise<string | null> => {
  const result = await client.query<{ id: string }>(
    'SELECT id::text FROM contribution_activity WHERE contribution_id=$1',
    [contributionId]
  );
  return result.rows[0]?.id ?? null;
};
