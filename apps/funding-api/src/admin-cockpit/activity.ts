import type {
  AdminCockpitActivity,
  CockpitActivityItem,
  CockpitActivityKind
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { integer, localDay, readSnapshot } from './read.js';

const sources = [
  {
    table: 'fund_contributions',
    kinds: ['payment'],
    sql: `SELECT 'payment:' || id AS id, 'payment' AS kind,
      paid_at AS occurred_at, COALESCE(public_reference, left(id::text, 8)) AS reference,
      '/admin/fundraiser/contributions?contributionId=' || id AS admin_url
    FROM (SELECT DISTINCT ON (COALESCE(stripe_payment_intent_id, id::text)) * FROM fund_contributions
      WHERE paid_at IS NOT NULL AND status IN ('paid', 'refunded', 'disputed')
      ORDER BY COALESCE(stripe_payment_intent_id, id::text), paid_at, id) c`
  },
  {
    table: 'sponsorship_invoices',
    kinds: ['invoice'],
    sql: `SELECT 'invoice:' || id AS id, 'invoice' AS kind,
      issued_at AS occurred_at, invoice_number AS reference,
      '/admin/fundraiser/invoices?contributionId=' || contribution_id AS admin_url FROM sponsorship_invoices`
  },
  {
    table: 'sponsor_publication_drafts',
    kinds: ['publication'],
    sql: `SELECT 'publication:' || id AS id, 'publication' AS kind,
      published_at AS occurred_at, feed_target || ' / ' || channel AS reference,
      '/admin/fundraiser/publications?draftId=' || id AS admin_url
      FROM sponsor_publication_drafts WHERE published_at IS NOT NULL`
  },
  {
    table: 'admin_audit_log',
    kinds: ['review', 'information', 'refund'],
    sql: `SELECT DISTINCT ON (logical_id)
      logical_id AS id, kind, created_at AS occurred_at, left(entity_id, 8) AS reference,
      '/admin/fundraiser/sponsors?sponsorshipId=' || entity_id || '&tab=' || CASE WHEN kind = 'refund' THEN 'refund' ELSE 'audit' END AS admin_url
      FROM (SELECT *, CASE WHEN action = 'sponsorship.request_information' THEN 'information'
          WHEN action LIKE 'sponsorship_refund.%' THEN 'refund' ELSE 'review' END AS kind,
        CASE WHEN action = 'sponsorship.request_information' THEN 'information:' || COALESCE(metadata->>'messageId', id::text)
          WHEN action LIKE 'sponsorship_refund.%' THEN 'refund:' || COALESCE(metadata->>'refundId', id::text)
          ELSE 'review:' || id END AS logical_id
        FROM admin_audit_log WHERE entity_type = 'sponsorship'
          AND entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (action IN ('sponsorship_review.approved', 'sponsorship_review.rejected', 'sponsorship_review.pending_review', 'sponsorship.request_information')
            OR (action IN ('sponsorship_refund.stripe_full', 'sponsorship_refund.stripe_partial') AND metadata->>'refundStatus' = 'succeeded'))
      ) a ORDER BY logical_id, created_at, id`
  }
] as const;

export const getCockpitActivity = async (
  pool: Pool | null,
  now = new Date()
): Promise<AdminCockpitActivity> => {
  const today = localDay(now);
  const base: AdminCockpitActivity = {
    available: false,
    generatedAt: now.toISOString(),
    today,
    items: [],
    todayCounts: {
      payment: null,
      invoice: null,
      publication: null,
      review: null,
      information: null,
      refund: null
    },
    missingSources: sources.map((s) => s.table)
  };
  if (!pool) return base;
  return readSnapshot(pool, async (client) => {
    const items: CockpitActivityItem[] = [];
    const todayCounts = { ...base.todayCounts };
    const missingSources: string[] = [];
    for (const source of sources) {
      const presence = await client.query(
        'SELECT to_regclass($1) IS NOT NULL AS present',
        [source.table]
      );
      if (!presence.rows[0]?.present) {
        missingSources.push(source.table);
        continue;
      }
      for (const kind of source.kinds) todayCounts[kind] = 0;
      const result = await client.query<
        CockpitActivityItem & { today_count: string }
      >(
        `WITH events AS (${source.sql}), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY kind ORDER BY occurred_at DESC, id) AS position,
        count(*) FILTER (WHERE to_char(occurred_at AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') = $1)
          OVER (PARTITION BY kind)::text AS today_count
        FROM events WHERE occurred_at <= $2::timestamptz)
        SELECT id, kind, occurred_at::text AS "occurredAt", reference, admin_url AS "adminUrl", today_count
        FROM ranked WHERE position <= 8 ORDER BY occurred_at DESC, id`,
        [today, now.toISOString()]
      );
      for (const row of result.rows) {
        todayCounts[row.kind as CockpitActivityKind] = integer(row.today_count);
        items.push({
          id: row.id,
          kind: row.kind,
          occurredAt: new Date(row.occurredAt).toISOString(),
          reference: row.reference,
          adminUrl: row.adminUrl
        });
      }
    }
    return {
      ...base,
      available: missingSources.length < sources.length,
      missingSources,
      todayCounts,
      items: items
        .sort(
          (a, b) =>
            b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id)
        )
        .slice(0, 8)
    };
  });
};
