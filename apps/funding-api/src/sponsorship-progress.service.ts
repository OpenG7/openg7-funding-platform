import type {
  AdminSponsorshipProgress,
  AdminSponsorshipProgressResponse,
  SponsorshipMilestone,
  SponsorshipProgressDocument,
  SponsorshipProgressPublication
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { resolveSponsorshipBenefits } from '../../../packages/funding-core/src/index.js';

import { effectiveRefundsSql } from './fund-refund-projection.js';
import {
  sponsorshipAdminUrl,
  sponsorshipRef
} from './sponsorship-admin-presentation.js';
import { resolveSponsorshipSocialChannels } from './sponsorship-benefits.js';
import { summarizeSponsorshipMedia } from './sponsorship-media-policy.js';
import {
  loadSponsorshipAssistantDataset,
  type SponsorshipAssistantDataset
} from './admin-assistant/context.repository.js';
import { getAdminWorkQueue } from './admin-work-queue.service.js';
import { SPONSOR_WEBSITE_VISIBLE_SQL } from './sponsorship-website-eligibility.js';

interface RefundFact {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
}
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
  readonly refunds: readonly RefundFact[];
  readonly charges: readonly RefundFact[];
  readonly failedEmails: AdminSponsorshipProgress['failedEmails'];
  readonly failedStripeEvents: AdminSponsorshipProgress['failedStripeEvents'];
}

/** Pure projection. A later milestone never completes an earlier milestone. */
export const buildSponsorshipProgress = (
  source: SponsorshipAssistantDataset,
  facts: SponsorshipProgressFacts
): AdminSponsorshipProgress => {
  const { record, consent } = source;
  const currency = record.currency.toUpperCase();
  const sumDistinct = (rows: readonly RefundFact[]): number => {
    const amounts = new Map<string, number>();
    for (const row of rows) {
      if (
        row.currency.toUpperCase() !== currency ||
        !Number.isSafeInteger(row.amount) ||
        row.amount < 0
      )
        throw new Error('Inconsistent refund facts.');
      amounts.set(row.id, Math.max(amounts.get(row.id) ?? 0, row.amount));
    }
    const total = [...amounts.values()].reduce((a, b) => a + b, 0);
    if (!Number.isSafeInteger(total)) throw new Error('Invalid refund total.');
    return total;
  };
  const refunds = [...facts.refunds];
  if (
    record.refundStatus === 'completed' &&
    facts.refundId &&
    facts.refundAmountMinor !== null
  )
    refunds.push({
      id: facts.refundId,
      amount: facts.refundAmountMinor,
      currency
    });
  // Charge totals are cumulative snapshots, not additional refunds.
  const confirmedAmountMinor = Math.max(
    sumDistinct(refunds),
    sumDistinct(facts.charges),
    record.paymentStatus === 'refunded' ? facts.amountMinor : 0
  );
  const credits = facts.documents.filter(
    (d) => d.kind === 'credit_note' && d.currency.toUpperCase() === currency
  );
  const credited = credits.reduce((sum, d) => sum + d.amountMinor, 0);
  const creditMissing =
    confirmedAmountMinor > credited ||
    refunds.some(
      (r) =>
        (credits.find((d) => d.refundId === r.id)?.amountMinor ?? 0) < r.amount
    );
  const refundError =
    facts.refundError ||
    record.refundStatus === 'failed' ||
    confirmedAmountMinor > facts.amountMinor;
  const refundInProgress = ['requested', 'processing'].includes(
    record.refundStatus
  );
  const refundBlocksPublication =
    confirmedAmountMinor >= facts.amountMinor || refundInProgress;
  const refund: AdminSponsorshipProgress['refund'] = {
    workflow: record.refundStatus,
    state: refundError
      ? 'error'
      : refundInProgress
        ? 'pending'
        : confirmedAmountMinor > 0
          ? confirmedAmountMinor < facts.amountMinor
            ? 'partial'
            : 'complete'
          : 'not_required',
    confirmedAmountMinor,
    creditMissing,
    hasError: refundError
  };
  const coordinatesComplete = record.hasCompanyName && record.hasContactEmail;
  const identityComplete = Boolean(
    record.detailsSubmittedAt && coordinatesComplete
  );
  const { hasApprovedPresentation: imageApproved, pending: pendingMedia } =
    summarizeSponsorshipMedia(source.media);
  const mediaComplete = imageApproved && pendingMedia === 0;
  const paid = ['paid', 'refunded', 'disputed'].includes(record.paymentStatus);
  const invoice = facts.documents.some((d) => d.kind === 'invoice');
  const promises =
    currency === 'CAD'
      ? resolveSponsorshipSocialChannels(record.amount)
      : [
          ...new Set(
            facts.publications.map((publication) => publication.channel)
          )
        ];
  const cancelled = (d: SponsorshipProgressPublication) =>
    d.deliveryStatus === 'cancelled' ||
    d.deliveryStatus === 'rejected' ||
    d.status === 'cancelled' ||
    d.status === 'rejected' ||
    d.batchStatus === 'cancelled' ||
    d.slotStatus === 'cancelled';
  const published = (d: SponsorshipProgressPublication) =>
    (d.status === 'published' && d.deliveryMode !== 'mock') ||
    (d.deliveryStatus === 'published' && d.deliveryMode === 'live');
  const websiteRequired =
    currency === 'CAD' &&
    resolveSponsorshipBenefits(
      facts.amountMinor / 100
    ).achievedBenefits.includes('website_mention');
  const publicationCompletion = {
    total: Number(websiteRequired) + promises.length,
    done:
      Number(websiteRequired && facts.websiteVisible) +
      promises.filter((channel) =>
        facts.publications.some((d) => d.channel === channel && published(d))
      ).length
  };
  const publicationComplete =
    (websiteRequired || promises.length > 0) &&
    (!websiteRequired || facts.websiteVisible) &&
    promises.every((channel) =>
      facts.publications.some((d) => d.channel === channel && published(d))
    );
  const publicationError = facts.publications.some(
    (d) =>
      ['failed', 'uncertain'].includes(d.deliveryStatus ?? '') && !published(d)
  );
  const publicationCancelled = facts.publications.some(
    (d) => !published(d) && cancelled(d)
  );
  // Shared read-only prerequisites; identity belongs to the website, hidden to social.
  const visibilityBlockers = (target: 'website' | 'social'): string[] => [
    ...(!consent ? ['consent'] : []),
    ...(record.reviewStatus !== 'approved' ? ['review'] : []),
    ...(target === 'website' && !record.hasCompanyName ? ['identity'] : []),
    ...(!imageApproved ? ['media'] : []),
    ...(record.paymentStatus !== 'paid' ? ['payment'] : []),
    ...(refundBlocksPublication ? ['refund'] : []),
    ...(target === 'social' && ['hidden'].includes(record.feedStatus)
      ? ['hidden']
      : [])
  ];
  const publicationBlockers = visibilityBlockers('social');
  const publicationBlocked =
    publicationBlockers.length > 0 ||
    facts.publications.some(
      (d) => d.deliveryStatus === 'blocked' && !published(d)
    );
  const websiteBlockers = visibilityBlockers('website');
  const milestones: SponsorshipMilestone[] = [
    {
      id: 'payment',
      state:
        record.paymentStatus === 'disputed'
          ? 'error'
          : paid
            ? 'complete'
            : ['cancelled', 'expired'].includes(record.paymentStatus)
              ? 'cancelled'
              : record.paymentStatus === 'failed'
                ? 'error'
                : 'pending',
      reason:
        record.paymentStatus === 'disputed'
          ? 'payment_disputed'
          : paid
            ? 'payment_recorded'
            : 'payment_unconfirmed',
      tab: 'overview'
    },
    {
      id: 'identity',
      state: identityComplete
        ? 'complete'
        : coordinatesComplete
          ? 'pending'
          : 'blocked',
      reason: identityComplete
        ? 'identity_complete'
        : coordinatesComplete
          ? 'identity_submission_pending'
          : 'identity_missing',
      tab: 'identity'
    },
    {
      id: 'media',
      state: mediaComplete
        ? 'complete'
        : pendingMedia > 0
          ? 'pending'
          : 'blocked',
      reason: mediaComplete ? 'media_approved' : 'media_review',
      tab: 'media'
    },
    {
      id: 'review',
      state:
        record.reviewStatus === 'approved'
          ? 'complete'
          : record.reviewStatus === 'rejected'
            ? 'blocked'
            : 'pending',
      reason:
        record.reviewStatus === 'approved'
          ? 'review_approved'
          : record.reviewStatus === 'rejected'
            ? 'review_rejected'
            : 'review_pending',
      tab: 'overview'
    },
    {
      id: 'billing',
      state: creditMissing
        ? 'blocked'
        : invoice
          ? 'complete'
          : paid && facts.requiresInvoice
            ? 'blocked'
            : 'not_required',
      reason: creditMissing
        ? 'credit_missing'
        : invoice
          ? 'invoice_issued'
          : !facts.requiresInvoice
            ? 'invoice_not_required'
            : paid
              ? 'invoice_missing'
              : 'invoice_waiting',
      tab: 'billing'
    },
    {
      id: 'publication',
      state: publicationComplete
        ? 'complete'
        : publicationError
          ? 'error'
          : publicationCancelled
            ? 'cancelled'
            : publicationBlocked
              ? 'blocked'
              : (websiteRequired && facts.websiteVisible) ||
                  facts.publications.some(published)
                ? 'partial'
                : 'pending',
      reason: publicationComplete
        ? 'publication_done'
        : publicationError
          ? 'publication_failed'
          : publicationCancelled
            ? 'publication_cancelled'
            : !consent
              ? 'consent_missing'
              : publicationBlocked
                ? 'publication_blocked'
                : 'publication_pending',
      tab: 'publication'
    }
  ];
  const outstanding = milestones.find(
    (m) => m.state !== 'complete' && m.state !== 'not_required'
  );
  const next =
    refundError || refundInProgress
      ? { reason: 'refund_check', tab: 'refund' as const }
      : creditMissing
        ? { reason: 'credit_missing', tab: 'billing' as const }
        : facts.failedStripeEvents.length
          ? { reason: 'stripe_failed', tab: 'overview' as const }
          : facts.failedEmails.length
            ? { reason: 'email_failed', tab: 'billing' as const }
            : record.reviewStatus === 'rejected'
              ? { reason: 'review_rejected', tab: 'overview' as const }
              : outstanding
                ? { reason: outstanding.reason, tab: outstanding.tab }
                : { reason: 'complete', tab: 'overview' as const };
  return {
    contributionId: record.contributionId,
    reference: sponsorshipRef(record),
    companyName: facts.companyName,
    version: source.version,
    amountMinor: facts.amountMinor,
    currency,
    paymentStatus: record.paymentStatus,
    reviewStatus: record.reviewStatus,
    publicConsent: consent,
    publicEligible:
      paid &&
      consent &&
      record.reviewStatus === 'approved' &&
      record.hasCompanyName &&
      imageApproved,
    feedStatus: record.feedStatus,
    publicationCompletion,
    website: {
      visible: facts.websiteVisible,
      held: facts.websiteHeld,
      canPublish: websiteBlockers.length === 0,
      version: facts.websiteVersion,
      blockers: websiteBlockers
    },
    publicationBlockers,
    milestones,
    next: {
      ...next,
      adminUrl: sponsorshipAdminUrl(record.contributionId, next.tab)
    },
    documents: facts.documents.map(
      ({ id, number, kind, amountMinor, currency, issuedAt }) => ({
        id,
        number,
        kind,
        amountMinor,
        currency,
        issuedAt
      })
    ),
    publications: facts.publications,
    refund,
    failedEmails: facts.failedEmails,
    failedStripeEvents: facts.failedStripeEvents
  };
};

export const getSponsorshipProgress = async (
  pool: Pool | null,
  id?: string,
  now = new Date()
): Promise<AdminSponsorshipProgressResponse> => {
  const base = { generatedAt: now.toISOString(), dossier: null };
  if (!pool) return { ...base, status: 'unavailable' };
  if (!id) {
    const queue = await getAdminWorkQueue(pool, {}, now);
    if (!queue.available) return { ...base, status: 'unavailable' };
    id = queue.firstSponsorshipId ?? undefined;
    if (!id) return { ...base, status: 'empty' };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const source = await loadSponsorshipAssistantDataset(client, id, now);
    if (!source) {
      await client.query('COMMIT');
      return { ...base, status: 'not_found' };
    }
    id = source.record.contributionId;
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
    const auditRefunds = await client.query<RefundFact>(
      `SELECT metadata->>'refundId' AS id, (metadata->>'amount')::integer AS amount, metadata->>'currency' AS currency
      FROM admin_audit_log WHERE entity_type = 'sponsorship' AND entity_id = $1 AND action IN ('sponsorship_refund.stripe_full', 'sponsorship_refund.stripe_partial')
      AND metadata->>'refundStatus' = 'succeeded' AND metadata->>'refundId' IS NOT NULL`,
      [id]
    );
    // Only processed Stripe facts, matched to this contribution; never expose raw payloads.
    const stripeRefunds = await client.query<{
      id: string;
      amount: number;
      currency: string;
      refunds: RefundFact[];
    }>(
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
    const dossier = buildSponsorshipProgress(source, {
      ...details.rows[0]!,
      documents: documents.rows,
      publications: publications.rows,
      refunds: [
        ...auditRefunds.rows,
        ...stripeRefunds.rows.flatMap((r) => r.refunds)
      ],
      charges: stripeRefunds.rows,
      failedEmails: failedEmails.rows,
      failedStripeEvents: failedStripeEvents.rows
    });
    const activity = await client.query<{ id: string }>(
      'SELECT id::text FROM contribution_activity WHERE contribution_id=$1',
      [id]
    );
    await client.query('COMMIT');
    return {
      ...base,
      status: 'ok',
      dossier: {
        ...dossier,
        preparationActivityId: activity.rows[0]?.id ?? null
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
