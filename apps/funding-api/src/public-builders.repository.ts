import { createHash } from 'node:crypto';

import type {
  PublicBuildersResponse,
  PublicBuilderProfile
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import {
  getTablePresence,
  type TablePresenceRow
} from './fund-transparency-presence.repository.js';
import { centsToAmount, parseDbInt } from './fund-transparency-projection.js';
import type { PublicDirectoryPagination } from './public-directory-pagination.js';

interface PublicBuilderRow {
  readonly display_name: string;
  readonly contribution_type: 'personal_support' | 'sponsorship_interest';
  readonly amount: string | null;
  readonly currency: string;
  readonly paid_at: string | null;
}

const getPublicBuilderPage = async (
  pool: Pool,
  tables: TablePresenceRow,
  { page, pageSize }: PublicDirectoryPagination
): Promise<PublicBuildersResponse> => {
  const empty: PublicBuildersResponse = {
    data_source: 'empty',
    builders: [],
    last_updated_at: new Date().toISOString(),
    pagination: { page, page_size: pageSize, total_count: 0 }
  };
  if (!tables.has_fund_contributions) return empty;
  const sponsorshipFilter = tables.has_sponsor_review_status
    ? "AND (contribution_type <> 'sponsorship_interest' OR (sponsor_review_status = 'approved' AND COALESCE((to_jsonb(fund_contributions)->>'sponsor_site_visibility_held')::boolean,FALSE) IS FALSE))"
    : "AND contribution_type <> 'sponsorship_interest'";
  const result = await pool.query<
    PublicBuilderRow & {
      contribution_id: string | null;
      total_count: string;
      last_updated_at: string | null;
    }
  >(
    `
    WITH eligible AS (
      SELECT id AS contribution_id, public_name AS display_name, contribution_type,
        CASE WHEN display_amount_consent IS TRUE THEN amount_cents::text ELSE NULL END AS amount,
        currency, paid_at::text AS paid_at, updated_at,
        COALESCE(paid_at, updated_at, created_at) AS sort_at
      FROM fund_contributions
      WHERE status IN ('paid', 'refunded', 'disputed')
        AND public_display_consent IS TRUE
        AND public_name IS NOT NULL AND btrim(public_name) <> ''
        ${sponsorshipFilter}
    ), totals AS (
      SELECT COUNT(*)::text AS total_count, MAX(updated_at)::text AS last_updated_at FROM eligible
    ), selected_page AS (
      SELECT * FROM eligible ORDER BY sort_at DESC, contribution_id DESC LIMIT $1 OFFSET $2
    )
    SELECT selected_page.*, totals.* FROM totals LEFT JOIN selected_page ON TRUE
    ORDER BY selected_page.sort_at DESC, selected_page.contribution_id DESC
  `,
    [pageSize, (page - 1) * pageSize]
  );
  return {
    data_source: 'database',
    builders: result.rows
      .filter((row) => row.contribution_id !== null)
      .map((row) => ({
        public_id: createHash('sha256')
          .update('public-builder:' + row.contribution_id)
          .digest('hex'),
        display_name: row.display_name,
        contribution_type: row.contribution_type,
        amount:
          row.amount === null ? null : centsToAmount(parseDbInt(row.amount)),
        currency: row.currency.toUpperCase(),
        paid_at: row.paid_at
      })),
    last_updated_at: result.rows[0]?.last_updated_at ?? empty.last_updated_at,
    pagination: {
      page,
      page_size: pageSize,
      total_count: Number(result.rows[0]?.total_count ?? 0)
    }
  };
};

export const listPublicBuilders = async (
  pool: Pool | null,
  { page = 1, pageSize = 24 }: Partial<PublicDirectoryPagination> = {}
): Promise<PublicBuildersResponse> => {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100_000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50
  )
    throw new RangeError('Invalid public directory pagination');
  if (!pool)
    return {
      data_source: 'empty',
      builders: [],
      last_updated_at: new Date().toISOString(),
      pagination: { page, page_size: pageSize, total_count: 0 }
    };
  return getPublicBuilderPage(pool, await getTablePresence(pool), {
    page,
    pageSize
  });
};

// Preserve the historical transparency preview of 24 records.
export const getPublicBuilders = async (
  pool: Pool,
  tables: TablePresenceRow
): Promise<readonly PublicBuilderProfile[]> =>
  (await getPublicBuilderPage(pool, tables, { page: 1, pageSize: 24 }))
    .builders;
