import type {
  AdminAttentionItem,
  AdminPaymentJourney,
  AdminPaymentJourneyResponse,
  AdminPaymentJourneyStep,
  AdminSponsorshipProgress,
  ContributionType
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { loadReliabilityFollowupItems } from './admin-work-queue/reliability-followup.js';
import { loadSponsorshipAssistantDataset } from './admin-assistant/context.repository.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { buildSponsorshipProgress } from './sponsorship-progress.service.js';
import { loadSponsorshipProgressFacts } from './sponsorship-progress.repository.js';
import { sponsorshipAdminUrl } from './sponsorship-admin-presentation.js';

export interface PaymentJourneySource {
  readonly contributionId: string;
  readonly reference: string;
  readonly contributionType: ContributionType;
  readonly amountMinor: number;
  readonly currency: string;
  readonly paymentStatus: string;
}
interface PaymentCommunication {
  readonly id: string;
  readonly status: string;
}
const settled = (step: AdminPaymentJourneyStep): boolean =>
  step.state === 'complete' || step.state === 'not_required';

const journeyTarget = (tab: string): string =>
  tab === 'publication' ? 'dossier-publication-journey' : 'sponsorship-dossier';

/** Navigation and completion derive only from server facts, never a local tick. */
export function buildPaymentJourney(
  source: PaymentJourneySource,
  dossier: AdminSponsorshipProgress | null,
  items: readonly AdminAttentionItem[] = [],
  communications: readonly PaymentCommunication[] = [],
  stripeFailed:
    | boolean
    | {
        readonly id: string;
        readonly type: 'stripe_event_failed' | 'stripe_event_stalled';
      } = false
): AdminPaymentJourney {
  if (
    !Number.isSafeInteger(source.amountMinor) ||
    source.amountMinor < 0 ||
    !/^[A-Z]{3}$/.test(source.currency)
  ) {
    throw new Error('Invalid payment facts.');
  }
  if (dossier && dossier.contributionId !== source.contributionId)
    throw new Error('Payment dossier mismatch.');
  const contributionUrl = `/admin/fundraiser/contributions?contributionId=${source.contributionId}`;
  const personal = source.contributionType === 'personal_support';
  const unsent =
    communications.find((message) => message.status === 'failed') ??
    communications.find((message) => message.status === 'uncertain') ??
    communications.find((message) => message.status !== 'sent');
  const stripeUrl =
    typeof stripeFailed === 'object'
      ? `/admin/fundraiser/attention?${new URLSearchParams({ itemId: `${stripeFailed.type}:${stripeFailed.id}` })}`
      : '/admin/fundraiser/attention?type=stripe_event_failed';
  const paid = ['paid', 'refunded'].includes(source.paymentStatus);
  const steps: AdminPaymentJourneyStep[] = dossier
    ? dossier.milestones.map((step) => ({
        ...step,
        adminUrl: sponsorshipAdminUrl(source.contributionId, step.tab),
        target: journeyTarget(step.tab)
      }))
    : [
        {
          id: 'payment',
          state:
            paid && personal
              ? 'complete'
              : source.paymentStatus === 'pending'
                ? 'pending'
                : 'blocked',
          reason:
            personal && paid
              ? source.paymentStatus === 'refunded'
                ? 'personal_refunded'
                : 'personal_complete'
              : source.paymentStatus === 'disputed'
                ? 'payment_disputed'
                : source.paymentStatus === 'pending'
                  ? 'payment_pending'
                  : !personal && paid
                    ? 'commitment_needs_confirmation'
                    : 'payment_blocked',
          adminUrl: contributionUrl,
          target: 'contribution-detail'
        }
      ];
  if (
    dossier &&
    dossier.next.reason !== 'complete' &&
    !(
      unsent &&
      ['email_failed', 'email_uncertain'].includes(dossier.next.reason)
    ) &&
    !steps.some((step) => step.reason === dossier.next.reason)
  ) {
    steps.unshift({
      id: 'incident',
      state: dossier.next.reason === 'refund_check' ? 'pending' : 'error',
      reason: dossier.next.reason,
      adminUrl:
        dossier.next.reason === 'stripe_failed'
          ? stripeUrl
          : dossier.next.adminUrl,
      target:
        dossier.next.reason === 'stripe_failed'
          ? 'attention-items'
          : journeyTarget(dossier.next.tab)
    });
  }
  for (const item of items) {
    if (
      item.severity === 'informational' ||
      (item.contributionId !== source.contributionId &&
        item.sponsorshipId !== source.contributionId)
    )
      continue;
    if (
      ![
        'sponsorship_timing_review',
        'publication_reliability_incident'
      ].includes(item.type)
    )
      continue;
    steps.push({
      id: item.id,
      state: 'blocked',
      reason: item.type,
      adminUrl: item.adminUrl ?? sponsorshipAdminUrl(source.contributionId),
      target: 'sponsorship-dossier'
    });
  }
  if (communications.length) {
    const pending = unsent && ['queued', 'sending'].includes(unsent.status);
    steps.push({
      id: 'communications',
      state: unsent ? (pending ? 'pending' : 'error') : 'complete',
      reason: unsent
        ? unsent.status === 'failed'
          ? 'email_failed'
          : pending
            ? 'email_pending'
            : 'email_uncertain'
        : 'email_complete',
      adminUrl: `/admin/fundraiser/email-queue${unsent ? '?messageId=' + encodeURIComponent(unsent.id) : ''}`,
      ...(unsent?.status === 'uncertain'
        ? { target: 'email-delivery-evidence' }
        : {})
    });
  }
  if (stripeFailed && !steps.some((step) => step.reason === 'stripe_failed')) {
    steps.unshift({
      id: 'stripe',
      state: 'error',
      reason: 'stripe_failed',
      adminUrl: stripeUrl,
      target: 'attention-items'
    });
  }
  const outstanding = steps.filter((step) => !settled(step));
  const next =
    outstanding.find((step) => step.state === 'error') ?? outstanding[0];
  const waiting =
    next?.reason === 'email_pending' || next?.reason === 'payment_pending';
  return {
    ...source,
    state: !next
      ? 'complete'
      : waiting
        ? 'waiting'
        : next.state === 'blocked'
          ? 'blocked'
          : 'action_required',
    completed: steps.filter(settled).length,
    total: steps.length,
    steps,
    next: next
      ? {
          reason: next.reason,
          adminUrl: next.adminUrl,
          ...(next.target ? { target: next.target } : {})
        }
      : null
  };
}

/** A private, read-only snapshot; reading this endpoint never prepares or sends. */
export async function getPaymentJourney(
  pool: Pool | null,
  contributionId: string,
  now = new Date()
): Promise<AdminPaymentJourneyResponse> {
  const base = { generatedAt: now.toISOString(), journey: null };
  if (!pool) return { ...base, status: 'unavailable' };
  return withPostgresTransaction(
    pool,
    (client) => loadPaymentJourneyOnClient(client, contributionId, now),
    { readOnlySnapshot: true }
  );
}

/** Compose within the caller's stable snapshot; this port performs no mutation. */
export async function loadPaymentJourneyOnClient(
  client: PoolClient,
  contributionId: string,
  now = new Date()
): Promise<AdminPaymentJourneyResponse> {
  const base = { generatedAt: now.toISOString(), journey: null };
  const result = await client.query<PaymentJourneySource>(
    `SELECT id::text AS "contributionId", COALESCE(public_reference, '#' || LEFT(id::text, 8)) AS reference,
       contribution_type AS "contributionType", amount_cents AS "amountMinor", UPPER(currency) AS currency, status AS "paymentStatus"
       FROM fund_contributions WHERE id=$1::uuid`,
    [contributionId]
  );
  const source = result.rows[0];
  if (!source) return { ...base, status: 'not_found' };
  const communications = await client.query<PaymentCommunication>(
    `SELECT id::text, status FROM email_messages WHERE
       metadata->>'contributionId'=$1 OR metadata->>'invoiceId' IN
         (SELECT id::text FROM sponsorship_invoices WHERE contribution_id=$1::uuid)
       OR metadata->>'creditNoteId' IN
         (SELECT id::text FROM sponsorship_credit_notes WHERE contribution_id=$1::uuid)
       ORDER BY created_at, id`,
    [contributionId]
  );
  const errors = await client.query<{ id: string; status: string }>(
    `SELECT e.stripe_event_id AS id, e.processing_status AS status FROM stripe_events e JOIN fund_contributions c ON c.id=$1::uuid
       WHERE (e.processing_status='failed' OR (e.processing_status='processing' AND e.received_at<=$2::timestamptz))
       AND (e.payload->'data'->'object'->>'id' IN (c.stripe_payment_intent_id,c.stripe_session_id)
       OR COALESCE(e.payload->'data'->'object'->'payment_intent'->>'id',e.payload->'data'->'object'->>'payment_intent')=c.stripe_payment_intent_id)
       ORDER BY (e.processing_status='failed') DESC, e.received_at, e.stripe_event_id LIMIT 1`,
    [contributionId, new Date(now.getTime() - 15 * 60 * 1000).toISOString()]
  );
  let dossier: AdminSponsorshipProgress | null = null;
  if (
    source.contributionType === 'sponsorship_interest' &&
    ['paid', 'refunded', 'disputed'].includes(source.paymentStatus)
  ) {
    const context = await loadSponsorshipAssistantDataset(
      client,
      contributionId,
      now
    );
    if (!context) return { ...base, status: 'unavailable' };
    dossier = buildSponsorshipProgress(
      context,
      await loadSponsorshipProgressFacts(client, contributionId)
    );
  }
  return {
    status: 'ok',
    generatedAt: base.generatedAt,
    journey: buildPaymentJourney(
      source,
      dossier,
      await loadReliabilityFollowupItems(client, now, contributionId),
      communications.rows,
      errors.rows[0]
        ? {
            id: errors.rows[0].id,
            type:
              errors.rows[0].status === 'failed'
                ? 'stripe_event_failed'
                : 'stripe_event_stalled'
          }
        : false
    )
  };
}
