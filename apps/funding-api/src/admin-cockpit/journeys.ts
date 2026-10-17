import type {
  AdminPlatformJourneyId,
  AdminPlatformJourneys
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { normalizeContributionPublicReference } from '../contribution-public-reference.js';
import { SPONSOR_WEBSITE_VISIBLE_SQL } from '../sponsorship-website-eligibility.js';

import {
  buildPlatformJourneys,
  type JourneyFacts
} from './journeys.projection.js';
import { readSnapshot } from './read.js';

type Facts = Partial<Record<AdminPlatformJourneyId, JourneyFacts>>;
type Row = Record<string, string | boolean | null>;
const at = (value: Row[string]): string | null =>
  typeof value === 'string' ? value : null;
const environment = (value: Row[string]): 'live' | 'test' | 'unknown' =>
  value === 'true' || value === 'live'
    ? 'live'
    : value === 'false' || value === 'mock'
      ? 'test'
      : 'unknown';

/** One witness joins Checkout, the authoritative processed event and its financial record. */
const paymentWitness = `SELECT c.id,c.paid_at,c.stripe_session_id,c.stripe_payment_intent_id,c.public_reference,
  c.amount_cents,c.currency,s.created_at AS checkout_at,e.processed_at AS event_at,e.payload->>'livemode' AS environment
  FROM fund_contributions c
  JOIN stripe_checkout_sessions s ON s.stripe_session_id=c.stripe_session_id
    AND s.stripe_payment_intent_id=c.stripe_payment_intent_id
    AND s.amount_cents=c.amount_cents AND upper(s.currency)=upper(c.currency)
  JOIN fund_transactions t ON t.stripe_object_id=c.stripe_payment_intent_id
    AND t.type='payment_intent.succeeded' AND t.status='succeeded'
    AND t.amount=c.amount_cents AND upper(t.currency)=upper(c.currency)
  JOIN stripe_events e ON e.stripe_event_id=t.stripe_event_id AND e.processing_status='processed'
    AND e.event_type='payment_intent.succeeded' AND e.payload->'data'->'object'->>'id'=c.stripe_payment_intent_id
  WHERE c.status IN ('paid','refunded','disputed') AND c.paid_at IS NOT NULL
    AND c.paid_at<=$1::timestamptz AND e.processed_at<=$1::timestamptz
    AND s.created_at<=$1::timestamptz`;

/** Only current, still-authorized website periods can supply successes or incidents. */
const sponsorshipObservation = `FROM fund_contributions
  JOIN sponsorship_obligations ob ON ob.contribution_id=fund_contributions.id
  JOIN sponsorship_commitments commitment ON commitment.id=ob.commitment_id AND commitment.state='active'
  JOIN LATERAL (SELECT * FROM sponsorship_website_exposure_observations
    WHERE obligation_id=ob.id AND observed_at<=$1::timestamptz
    ORDER BY observed_at DESC,id DESC LIMIT 1) anchor ON TRUE
  JOIN sponsorship_public_visibility_observations v ON v.obligation_id=ob.id AND v.start_observation_id=anchor.id
  WHERE ob.channel='website' AND ob.target='openg7' AND ob.state IN ('pending','blocked')
    AND fund_contributions.status='paid' AND fund_contributions.sponsorship_refund_status='not_requested'
    AND anchor.obligation_version=ob.version AND v.obligation_version=ob.version
    AND v.checked_at<=$1::timestamptz AND v.checked_at>=anchor.observed_at
    AND v.checked_at>=fund_contributions.updated_at
    AND NOT EXISTS(SELECT 1 FROM sponsor_media_assets a WHERE a.contribution_id=fund_contributions.id AND a.updated_at>v.checked_at)
    AND (${SPONSOR_WEBSITE_VISIBLE_SQL})`;

const tables = [
  'fund_contributions',
  'stripe_checkout_sessions',
  'stripe_events',
  'fund_transactions',
  'sponsorship_invoices',
  'email_messages',
  'publication_deliveries',
  'publication_feeds',
  'sponsor_publication_drafts',
  'sponsor_media_assets',
  'sponsorship_public_visibility_observations',
  'sponsorship_website_exposure_observations',
  'sponsorship_obligations',
  'sponsorship_commitments',
  'moderation_cases',
  'moderation_decisions',
  'moderation_policies',
  'moderation_appeals',
  'moderation_legacy_visibility'
] as const;

const readFacts = async (client: PoolClient, now: Date): Promise<Facts> => {
  const presence = await client.query<{ name: string; present: boolean }>(
    'SELECT name,to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) AS name',
    [tables]
  );
  const present = new Set(
    presence.rows.filter((r) => r.present).map((r) => r.name)
  );
  const has = (...names: readonly string[]) =>
    names.every((name) => present.has(name));
  const facts: Facts = {};
  const time = [now.toISOString()];
  const paymentsAvailable = has(
    'fund_contributions',
    'stripe_checkout_sessions',
    'stripe_events',
    'fund_transactions'
  );

  if (paymentsAvailable) {
    const row = (
      await client.query<Row>(
        `WITH witness AS (${paymentWitness})
      SELECT checkout_at::text,event_at::text,paid_at::text,public_reference,
        greatest(paid_at,event_at)::text AS observed_at,environment FROM witness
      ORDER BY greatest(paid_at,event_at) DESC LIMIT 1`,
        time
      )
    ).rows[0];
    const reference = at(row?.public_reference);
    const followup =
      reference !== null &&
      normalizeContributionPublicReference(reference) === reference;
    facts.contribution = {
      source: 'available',
      complete: followup,
      observedAt: at(row?.observed_at),
      environment: environment(row?.environment),
      steps: row
        ? {
            checkout: at(row.checkout_at),
            payment: at(row.event_at),
            confirmation: at(row.paid_at),
            followup: followup ? at(row.paid_at) : null
          }
        : {}
    };
  }

  if (paymentsAvailable && has('sponsorship_invoices', 'email_messages')) {
    const row = (
      await client.query<Row>(
        `WITH witness AS (${paymentWitness})
      SELECT w.paid_at::text,w.environment,i.issued_at::text,m.sent_at::text,m.status,
        greatest(w.paid_at,i.issued_at,m.sent_at)::text AS observed_at
      FROM witness w JOIN sponsorship_invoices i ON i.contribution_id=w.id
        AND i.stripe_session_id=w.stripe_session_id
        AND i.total_cents=w.amount_cents AND upper(i.currency)=upper(w.currency)
      LEFT JOIN LATERAL (SELECT status,sent_at FROM email_messages
        WHERE template_key='sponsorship_invoice' AND metadata->>'invoiceId'=i.id::text
        ORDER BY created_at DESC,id DESC LIMIT 1) m ON TRUE
      WHERE i.issued_at<=$1::timestamptz AND (m.sent_at IS NULL OR m.sent_at<=$1::timestamptz)
      ORDER BY greatest(w.paid_at,i.issued_at,m.sent_at) DESC LIMIT 1`,
        time
      )
    ).rows[0];
    facts.invoicing = {
      source: 'available',
      complete: row?.status === 'sent' && row.sent_at !== null,
      observedAt: at(row?.observed_at),
      environment: environment(row?.environment),
      steps: row
        ? {
            payment: at(row.paid_at),
            invoice: at(row.issued_at),
            email: row.status === 'sent' ? at(row.sent_at) : null
          }
        : {}
    };
    const issue = (
      await client.query<Row>(
        `SELECT m.status,m.updated_at::text
      FROM email_messages m JOIN sponsorship_invoices i ON m.metadata->>'invoiceId'=i.id::text
      WHERE m.template_key='sponsorship_invoice' AND m.updated_at<=$1::timestamptz AND
        (m.status IN ('failed','uncertain') OR
          (m.status='sending' AND m.updated_at<$1::timestamptz-interval '15 minutes') OR
          (m.status='queued' AND m.next_attempt_at<$1::timestamptz-interval '15 minutes'))
        AND NOT EXISTS(SELECT 1 FROM email_messages newer WHERE newer.template_key=m.template_key
          AND newer.metadata->>'invoiceId'=i.id::text AND (newer.created_at,newer.id)>(m.created_at,m.id))
      ORDER BY m.updated_at DESC LIMIT 1`,
        time
      )
    ).rows[0];
    if (issue)
      facts.invoicing = {
        ...facts.invoicing,
        issue: {
          stepId: 'email',
          observedAt: at(issue.updated_at),
          diagnostic:
            issue.status === 'uncertain'
              ? 'delivery_uncertain'
              : issue.status === 'failed'
                ? 'processing_failed'
                : 'processing_delayed'
        }
      };
  }

  if (has('fund_contributions')) {
    const row = (
      await client.query<Row>(
        `SELECT created_at::text,sponsor_reviewed_at::text,
      sponsor_review_status,updated_at::text FROM fund_contributions
      WHERE contribution_type='sponsorship_interest' AND created_at<=$1::timestamptz
      ORDER BY updated_at DESC,id DESC LIMIT 1`,
        time
      )
    ).rows[0];
    facts.sponsorship = {
      source: 'available',
      observedAt: at(row?.updated_at),
      waiting:
        row?.sponsor_review_status === 'pending_review'
          ? 'awaiting_review'
          : undefined,
      steps: row
        ? {
            dossier: at(row.created_at),
            review:
              row.sponsor_review_status === 'approved'
                ? at(row.sponsor_reviewed_at)
                : null
          }
        : {}
    };
    if (
      has(
        'sponsorship_public_visibility_observations',
        'sponsorship_website_exposure_observations',
        'sponsorship_obligations',
        'sponsorship_commitments',
        'sponsor_media_assets',
        'moderation_cases',
        'moderation_decisions',
        'moderation_policies',
        'moderation_appeals',
        'moderation_legacy_visibility'
      )
    ) {
      const visible = (
        await client.query<Row>(
          `SELECT fund_contributions.created_at::text,
        fund_contributions.sponsor_reviewed_at::text,v.checked_at::text,
        (SELECT max(updated_at)::text FROM sponsor_media_assets a WHERE a.contribution_id=fund_contributions.id
          AND a.deleted_at IS NULL AND a.review_status='approved') AS media_at
        ${sponsorshipObservation} AND v.status='visible'
          AND NOT EXISTS(SELECT 1 FROM sponsorship_public_visibility_observations newer
            WHERE newer.obligation_id=ob.id AND newer.start_observation_id=anchor.id AND newer.checked_at<=$1::timestamptz
              AND (newer.checked_at,newer.id)>(v.checked_at,v.id))
        ORDER BY v.checked_at DESC LIMIT 1`,
          time
        )
      ).rows[0];
      if (visible)
        facts.sponsorship = {
          source: 'available',
          complete: true,
          observedAt: at(visible.checked_at),
          steps: {
            dossier: at(visible.created_at),
            media: at(visible.media_at),
            review: at(visible.sponsor_reviewed_at),
            visibility: at(visible.checked_at)
          }
        };
      // A confirmed interruption invalidates its whole period, even after a healthy sample.
      const issue = (
        await client.query<Row>(
          `SELECT v.checked_at::text ${sponsorshipObservation}
        AND v.status IN ('changed','not_visible') ORDER BY v.checked_at DESC,v.id DESC LIMIT 1`,
          time
        )
      ).rows[0];
      if (issue)
        facts.sponsorship = {
          ...facts.sponsorship,
          issue: {
            stepId: 'visibility',
            observedAt: at(issue.checked_at),
            diagnostic: 'processing_failed'
          }
        };
    }
  }

  if (has('publication_deliveries', 'publication_feeds')) {
    const row = (
      await client.query<Row>(
        `SELECT approved_at::text,scheduled_at::text,published_at::text,mode,status,
      CASE WHEN status='published' AND approved_at IS NOT NULL AND approved_by IS NOT NULL
        AND external_post_id IS NOT NULL AND published_at>=approved_at AND published_at>=scheduled_at
        THEN TRUE ELSE FALSE END AS complete
      FROM publication_deliveries WHERE mode IN ('live','mock') AND status<>'cancelled'
        AND EXISTS(SELECT 1 FROM publication_feeds feed WHERE feed.id=publication_deliveries.feed_id AND feed.paused IS FALSE)
        AND created_at<=$1::timestamptz AND (published_at IS NULL OR published_at<=$1::timestamptz)
      ORDER BY COALESCE(published_at,approved_at,created_at) DESC,id DESC LIMIT 1`,
        time
      )
    ).rows[0];
    facts.publication = {
      source: 'available',
      complete: row?.complete === true,
      environment: environment(row?.mode),
      observedAt: at(row?.published_at) ?? at(row?.approved_at),
      waiting: row?.status === 'draft' ? 'awaiting_authorization' : undefined,
      steps: row
        ? {
            authorization: at(row.approved_at),
            scheduling: row.approved_at ? at(row.approved_at) : null,
            delivery: row.status === 'published' ? at(row.published_at) : null
          }
        : {}
    };
    const issue = (
      await client.query<Row>(
        `SELECT status,updated_at::text,mode FROM publication_deliveries
      WHERE mode IN ('live','mock') AND updated_at<=$1::timestamptz AND
        EXISTS(SELECT 1 FROM publication_feeds feed WHERE feed.id=publication_deliveries.feed_id AND feed.paused IS FALSE) AND
        (status IN ('blocked','uncertain') OR
          (status='publishing' AND lease_until<$1::timestamptz) OR
          (status='approved' AND scheduled_at<$1::timestamptz-interval '15 minutes'))
      ORDER BY updated_at DESC,id DESC LIMIT 1`,
        time
      )
    ).rows[0];
    if (issue)
      facts.publication = {
        ...facts.publication,
        issue: {
          stepId: 'delivery',
          observedAt: at(issue.updated_at),
          environment: environment(issue.mode),
          diagnostic:
            issue.status === 'uncertain'
              ? 'delivery_uncertain'
              : issue.status === 'blocked'
                ? 'processing_failed'
                : 'processing_delayed'
        }
      };
  }

  if (has('fund_transactions')) {
    const row = (
      await client.query<Row>(
        `SELECT max(inserted_at)::text AS observed_at FROM fund_transactions
      WHERE type='payment_intent.succeeded' AND status='succeeded' AND inserted_at<=$1::timestamptz`,
        time
      )
    ).rows[0];
    // Ledger reads alone cannot prove a public calculation or its displayed response.
    facts.transparency = {
      source: 'available',
      observedAt: at(row?.observed_at),
      steps: { transactions: at(row?.observed_at) }
    };
  }

  if (has('stripe_events')) {
    const issue = (
      await client.query<Row>(
        `SELECT processing_status,received_at::text,payload->>'livemode' AS environment FROM stripe_events
      WHERE event_type IN ('payment_intent.succeeded','checkout.session.completed') AND received_at<=$1::timestamptz
        AND (processing_status='failed' OR (processing_status='processing' AND received_at<$1::timestamptz-interval '15 minutes'))
      ORDER BY received_at DESC LIMIT 1`,
        time
      )
    ).rows[0];
    if (issue && facts.contribution)
      facts.contribution = {
        ...facts.contribution,
        issue: {
          stepId: 'confirmation',
          observedAt: at(issue.received_at),
          environment: environment(issue.environment),
          diagnostic:
            issue.processing_status === 'failed'
              ? 'processing_failed'
              : 'processing_delayed'
        }
      };
  }
  return facts;
};

/** No provider probes, queued work, audit writes, or public visibility observations are triggered. */
export const getCockpitJourneys = async (
  pool: Pool | null,
  now = new Date(),
  authenticatedRequest = false
): Promise<AdminPlatformJourneys> => {
  if (!pool) return buildPlatformJourneys({}, now, authenticatedRequest);
  try {
    const facts = await readSnapshot(pool, (client) => readFacts(client, now));
    return buildPlatformJourneys(facts, now, authenticatedRequest);
  } catch {
    // SQL/provider details can contain private data; expose only the fixed diagnostic.
    const unavailable = Object.fromEntries(
      [
        'contribution',
        'invoicing',
        'sponsorship',
        'publication',
        'transparency'
      ].map((id) => [id, { source: 'unavailable' as const }])
    );
    return buildPlatformJourneys(unavailable, now, authenticatedRequest);
  }
};
