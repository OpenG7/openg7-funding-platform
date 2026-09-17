import type { AdminCockpitMetrics, CockpitTrend } from '@openg7/funding-core';
import type { Pool } from 'pg';

import { integer, localDay, readSnapshot, shiftDay, sum } from './read.js';

export interface CockpitPayment {
  readonly currency: string;
  readonly amount: string | number;
  readonly fee: string | number | null;
  readonly refunded: string | number;
  readonly disputed: boolean;
  readonly sponsorship: boolean;
  readonly day: string | null;
  readonly inconsistentRefundCurrency?: boolean;
}

export const buildCockpitMetrics = (
  payments: readonly CockpitPayment[],
  plannedPublicationCount: number | null,
  warnings: AdminCockpitMetrics['warnings'] = [],
  now = new Date()
): AdminCockpitMetrics => {
  const today = localDay(now);
  const start = shiftDay(today, -30);
  const previous = shiftDay(today, -60);
  const trend = (
    rows: readonly CockpitPayment[],
    value: (p: CockpitPayment) => number | null
  ): CockpitTrend => {
    const total = (selected: readonly CockpitPayment[]): number | null => {
      const values = selected.map(value);
      return values.some((v) => v === null) ? null : sum(values as number[]);
    };
    const current = total(
      rows.filter((p) => p.day && p.day >= start && p.day < today)
    );
    const prior = total(
      rows.filter((p) => p.day && p.day >= previous && p.day < start)
    );
    const undated = rows.some((p) => p.day === null);
    return {
      current: undated ? null : current,
      previous: undated ? null : prior,
      percent:
        undated || current === null || prior === null || prior <= 0
          ? null
          : Math.round(((current - prior) / prior) * 1000) / 10,
      series: Array.from({ length: 30 }, (_, index) => {
        const day = shiftDay(start, index);
        return {
          day,
          value: undated ? null : total(rows.filter((p) => p.day === day))
        };
      })
    };
  };
  for (const payment of payments) {
    if (
      payment.inconsistentRefundCurrency ||
      !/^[A-Z]{3}$/.test(payment.currency) ||
      integer(payment.amount) < 0 ||
      integer(payment.refunded) < 0 ||
      integer(payment.refunded) > integer(payment.amount) ||
      (payment.fee !== null &&
        (integer(payment.fee) < 0 ||
          integer(payment.fee) > integer(payment.amount)))
    )
      throw new Error('Inconsistent payment projection');
  }
  return {
    available: true,
    source: 'postgresql',
    generatedAt: now.toISOString(),
    timezone: 'America/Toronto',
    period: { start, end: shiftDay(today, -1) },
    previousPeriod: { start: previous, end: shiftDay(start, -1) },
    currencies: [...new Set(payments.map((p) => p.currency))]
      .sort()
      .map((currency) => {
        const rows = payments.filter((p) => p.currency === currency);
        const grossMinor = sum(rows.map((p) => integer(p.amount)));
        const confirmedFeesMinor = sum(
          rows.map((p) => (p.fee === null ? 0 : integer(p.fee)))
        );
        const missingFeeCount = rows.filter((p) => p.fee === null).length;
        const refundedMinor = sum(rows.map((p) => integer(p.refunded)));
        const netReceivedMinor = missingFeeCount
          ? null
          : integer(grossMinor - confirmedFeesMinor);
        return {
          currency,
          grossMinor,
          confirmedFeesMinor,
          missingFeeCount,
          netReceivedMinor,
          refundedMinor,
          disputedMinor: sum(
            rows.filter((p) => p.disputed).map((p) => integer(p.amount))
          ),
          netAfterRefundsMinor:
            netReceivedMinor === null
              ? null
              : integer(netReceivedMinor - refundedMinor),
          grossTrend: trend(rows, (p) => integer(p.amount)),
          netTrend: trend(rows, (p) =>
            p.fee === null ? null : integer(integer(p.amount) - integer(p.fee))
          )
        };
      }),
    sponsorshipCount: payments.filter((p) => p.sponsorship).length,
    sponsorshipTrend: trend(
      payments.filter((p) => p.sponsorship),
      () => 1
    ),
    plannedPublicationCount,
    warnings: [
      ...new Set([
        ...warnings,
        ...(payments.some((p) => !p.day) ? ['undated_payments' as const] : [])
      ])
    ]
  };
};

// Only the admin read model changes. Existing public/accounting writers remain authoritative.
export const getCockpitMetrics = async (
  pool: Pool | null,
  now = new Date()
): Promise<AdminCockpitMetrics> => {
  const unavailable = {
    ...buildCockpitMetrics([], null, [], now),
    available: false
  };
  if (!pool) return unavailable;
  return readSnapshot(pool, async (client) => {
    const presence = await client.query<{
      finance: boolean;
      publications: boolean;
    }>(`SELECT
      to_regclass('fund_contributions') IS NOT NULL AND to_regclass('fund_transactions') IS NOT NULL
        AND to_regclass('stripe_events') IS NOT NULL AND to_regclass('admin_audit_log') IS NOT NULL AS finance,
      to_regclass('sponsor_publication_drafts') IS NOT NULL AND to_regclass('sponsor_publication_batches') IS NOT NULL
        AND to_regclass('publication_slots') IS NOT NULL AS publications`);
    if (!presence.rows[0]?.finance) return unavailable;
    const rows = await client.query<CockpitPayment>(
      `
      WITH contributions AS (
        SELECT DISTINCT ON (COALESCE(stripe_payment_intent_id, id::text)) * FROM fund_contributions
        WHERE status IN ('paid', 'refunded', 'disputed')
        ORDER BY COALESCE(stripe_payment_intent_id, id::text), paid_at NULLS LAST, id
      ), transactions AS (
        SELECT DISTINCT ON (stripe_object_id) * FROM fund_transactions
        WHERE type = 'payment_intent.succeeded' AND status = 'succeeded'
        ORDER BY stripe_object_id, (stripe_balance_transaction_id IS NOT NULL) DESC, inserted_at DESC, id DESC
      ), refunds AS (
        SELECT entity_id AS contribution_id, metadata->>'refundId' AS id,
          (metadata->>'amount')::bigint AS amount, upper(metadata->>'currency') AS currency
        FROM admin_audit_log WHERE entity_type = 'sponsorship'
          AND action IN ('sponsorship_refund.stripe_full', 'sponsorship_refund.stripe_partial')
          AND metadata->>'refundStatus' = 'succeeded' AND metadata->>'refundId' IS NOT NULL
        UNION ALL SELECT id::text, sponsorship_refund_id, sponsorship_refund_amount_cents, upper(currency)
        FROM contributions WHERE sponsorship_refund_status = 'completed'
          AND sponsorship_refund_id IS NOT NULL AND sponsorship_refund_amount_cents IS NOT NULL
      ), refund_totals AS (
        SELECT contribution_id, currency, sum(amount) AS amount FROM (
          SELECT contribution_id, currency, id, max(amount) AS amount FROM refunds GROUP BY contribution_id, currency, id
        ) r GROUP BY contribution_id, currency
      ), charge_facts AS (
        SELECT COALESCE(payload->'data'->'object'->'payment_intent'->>'id', payload->'data'->'object'->>'payment_intent') AS pi,
          payload->'data'->'object'->>'id' AS id, upper(payload->'data'->'object'->>'currency') AS currency,
          (payload->'data'->'object'->>'amount_refunded')::bigint AS amount
        FROM stripe_events WHERE event_type = 'charge.refunded' AND processing_status = 'processed'
        UNION ALL SELECT metadata_json->>'paymentIntentId', stripe_object_id, upper(currency), amount
        FROM fund_transactions WHERE type = 'charge.refunded' AND status = 'succeeded'
          AND metadata_json->>'source' = 'stripe_backfill' AND metadata_json->>'paymentIntentId' IS NOT NULL
      ), charges AS (
        SELECT pi, id, currency, max(amount) AS amount FROM charge_facts GROUP BY pi, id, currency
      ), charge_totals AS (SELECT pi, currency, sum(amount) AS amount FROM charges GROUP BY pi, currency)
      SELECT upper(c.currency) AS currency, c.amount_cents AS amount,
        CASE WHEN t.stripe_balance_transaction_id IS NOT NULL AND upper(t.currency) = upper(c.currency)
          AND t.amount = c.amount_cents AND t.net = t.amount - t.fee THEN t.fee::text ELSE NULL END AS fee,
        GREATEST(COALESCE(r.amount, 0), COALESCE(h.amount, 0), CASE WHEN c.status = 'refunded' AND r.amount IS NULL AND h.amount IS NULL THEN c.amount_cents ELSE 0 END)::text AS refunded,
        c.status = 'disputed' AS disputed, c.contribution_type = 'sponsorship_interest' AS sponsorship,
        (EXISTS(SELECT 1 FROM refund_totals x WHERE x.contribution_id = c.id::text AND x.currency IS DISTINCT FROM upper(c.currency))
          OR EXISTS(SELECT 1 FROM charge_totals x WHERE x.pi = c.stripe_payment_intent_id AND x.currency IS DISTINCT FROM upper(c.currency))) AS "inconsistentRefundCurrency",
        to_char(c.paid_at AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') AS day
      FROM contributions c LEFT JOIN transactions t ON t.stripe_object_id = c.stripe_payment_intent_id
      LEFT JOIN refund_totals r ON r.contribution_id = c.id::text AND r.currency = upper(c.currency)
      LEFT JOIN charge_totals h ON h.pi = c.stripe_payment_intent_id AND h.currency = upper(c.currency)
      WHERE c.paid_at IS NULL OR c.paid_at <= $1::timestamptz`,
      [now.toISOString()]
    );
    const anomalies = await client.query<{
      unlinked: boolean;
      duplicates: boolean;
    }>(`SELECT
      EXISTS(SELECT 1 FROM fund_transactions t WHERE t.type = 'payment_intent.succeeded' AND t.status = 'succeeded'
        AND NOT EXISTS(SELECT 1 FROM fund_contributions c WHERE c.stripe_payment_intent_id = t.stripe_object_id
          AND c.status IN ('paid', 'refunded', 'disputed'))) AS unlinked,
      EXISTS(SELECT stripe_payment_intent_id FROM fund_contributions WHERE stripe_payment_intent_id IS NOT NULL
        AND status IN ('paid', 'refunded', 'disputed') GROUP BY stripe_payment_intent_id HAVING count(*) > 1) AS duplicates`);
    let planned: number | null = null;
    if (presence.rows[0]?.publications) {
      const result = await client.query<{
        count: string;
      }>(`SELECT count(*)::text AS count FROM sponsor_publication_drafts d
        LEFT JOIN sponsor_publication_batches b ON b.id = d.batch_id
        LEFT JOIN publication_slots s ON s.id = COALESCE(d.slot_id, b.slot_id)
        WHERE d.status IN ('draft', 'approved', 'scheduled') AND COALESCE(b.status, '') <> 'cancelled'
          AND COALESCE(s.status, '') <> 'cancelled'`);
      planned = integer(result.rows[0]!.count);
    }
    return buildCockpitMetrics(
      rows.rows,
      planned,
      [
        ...(planned === null ? ['publications_unavailable' as const] : []),
        ...(anomalies.rows[0]?.unlinked
          ? ['unlinked_transactions' as const]
          : []),
        ...(anomalies.rows[0]?.duplicates
          ? ['duplicate_payments' as const]
          : [])
      ],
      now
    );
  });
};
