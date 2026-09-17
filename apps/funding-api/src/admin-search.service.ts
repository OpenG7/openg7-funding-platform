import type {
  AdminSearchRequest,
  AdminSearchResponse,
  AdminSearchGroup
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { integer, readSnapshot } from './admin-cockpit/read.js';

const sources = [
  'fund_contributions',
  'sponsorship_invoices',
  'sponsor_publication_drafts'
] as const;

export const parseAdminSearch = (
  body: unknown
): Required<AdminSearchRequest> => {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Invalid search');
  const { query, page = 1, pageSize = 10 } = body as Record<string, unknown>;
  if (typeof query !== 'string' || /[\u0000-\u001f\u007f]/u.test(query))
    throw new Error('Invalid search');
  const normalized = query.trim().normalize('NFC');
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    typeof page !== 'number' ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    typeof pageSize !== 'number' ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 20
  )
    throw new Error('Invalid search');
  return { query: normalized, page, pageSize };
};

/** Stored contribution amounts are cents. Parse decimal digits without floating-point arithmetic. */
export const searchAmount = (
  query: string
): { minor: number; currency: string | null } | null => {
  const match =
    /^(?:([a-z]{3})\s+)?(\d+)(?:[.,](\d{1,2}))?(?:\s+([a-z]{3}))?$/i.exec(
      query
    );
  if (!match || (match[1] && match[4])) return null;
  const minor =
    BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return {
    minor: Number(minor),
    currency: (match[1] ?? match[4])?.toLowerCase() ?? null
  };
};

const literalLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

// Only developer-owned identifiers are interpolated. Every search value is a bound parameter.
const textHits = (
  table: string,
  id: string,
  fields: readonly string[]
): string => `
  SELECT ${id} AS contribution_id, match.rank FROM ${table}
  CROSS JOIN LATERAL (
    SELECT min(CASE WHEN lower(value) = $1 THEN 0 WHEN lower(value) LIKE $2 THEN 1 ELSE 2 END) AS rank
    FROM unnest(ARRAY[${fields.join(', ')}]::text[]) AS field(value)
    WHERE lower(value) LIKE $3
  ) match WHERE match.rank IS NOT NULL`;

export const searchAdmin = async (
  pool: Pool | null,
  input: AdminSearchRequest
): Promise<AdminSearchResponse> => {
  const query = parseAdminSearch(input);
  const base: AdminSearchResponse = {
    available: false,
    missingSources: [...sources],
    groups: [],
    total: 0,
    page: query.page,
    pageSize: query.pageSize
  };
  if (!pool) return base;
  return readSnapshot(pool, async (client) => {
    const presence = await client.query<{ name: string; present: boolean }>(
      'SELECT name, to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) AS source(name)',
      [sources]
    );
    const missingSources = presence.rows
      .filter((row) => !row.present)
      .map((row) => row.name);
    if (missingSources.includes('fund_contributions'))
      return { ...base, missingSources };
    const invoices = !missingSources.includes('sponsorship_invoices');
    const publications = !missingSources.includes('sponsor_publication_drafts');
    const hits = [
      textHits('fund_contributions', 'id', [
        'id::text',
        'public_reference',
        'public_name',
        'sponsor_company_name',
        'email_private',
        'sponsor_contact_email',
        'sponsor_public_slug',
        'stripe_session_id',
        'stripe_payment_intent_id',
        'sponsorship_refund_id'
      ])
    ];
    if (invoices)
      hits.push(
        textHits('sponsorship_invoices', 'contribution_id', [
          'invoice_number',
          'id::text',
          'public_reference',
          'sponsor_name',
          'sponsor_contact_email',
          'stripe_session_id',
          'stripe_payment_intent_id'
        ])
      );
    if (publications)
      hits.push(
        textHits('sponsor_publication_drafts', 'contribution_id', [
          'id::text',
          'title'
        ])
      );
    hits.push(`SELECT id AS contribution_id, 0 AS rank FROM fund_contributions
      WHERE amount_cents = $4::bigint AND ($5::text IS NULL OR lower(currency) = $5)`);
    const term = query.query.toLowerCase();
    const escaped = literalLike(term);
    const amount = searchAmount(term);
    const result = await client.query<{
      total: string;
      groups: AdminSearchGroup[];
    }>(
      `
      WITH hits AS (${hits.join(' UNION ALL ')}), ranked AS (
        SELECT contribution_id, min(rank) AS rank FROM hits GROUP BY contribution_id
      ), page AS (
        SELECT c.*, r.rank FROM ranked r JOIN fund_contributions c ON c.id = r.contribution_id
        ORDER BY r.rank, c.id LIMIT $6 OFFSET $7
      )
      SELECT (SELECT count(*)::text FROM ranked) AS total,
        COALESCE((SELECT jsonb_agg(item ORDER BY rank, id) FROM (
          SELECT c.rank, c.id, jsonb_build_object(
            'contributionId', c.id,
            'title', COALESCE(NULLIF(c.sponsor_company_name, ''), NULLIF(c.public_name, ''), c.public_reference, left(c.id::text, 8)),
            'reference', c.public_reference, 'amountMinor', c.amount_cents, 'currency', upper(c.currency),
            'sponsorship', c.contribution_type = 'sponsorship_interest',
            'invoice', ${
              invoices
                ? `(SELECT jsonb_build_object('id', i.id, 'number', i.invoice_number)
              FROM sponsorship_invoices i WHERE i.contribution_id = c.id)`
                : 'NULL'
            },
            'publications', ${
              publications
                ? `COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'target', d.feed_target, 'channel', d.channel) ORDER BY d.feed_target, d.channel, d.id)
              FROM sponsor_publication_drafts d WHERE d.contribution_id = c.id), '[]'::jsonb)`
                : "'[]'::jsonb"
            }
          ) AS item FROM page c
        ) items), '[]'::jsonb) AS groups`,
      [
        term,
        escaped + '%',
        '%' + escaped + '%',
        amount?.minor ?? null,
        amount?.currency ?? null,
        query.pageSize,
        (query.page - 1) * query.pageSize
      ]
    );
    const row = result.rows[0]!;
    return {
      ...base,
      available: true,
      missingSources,
      groups: row.groups,
      total: integer(row.total)
    };
  });
};
