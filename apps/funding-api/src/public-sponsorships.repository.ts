import { createHash } from 'node:crypto';

import type {
  PublicSponsorshipProfile,
  PublicSponsorshipsResponse,
  SponsorFeedStatus,
  SponsorFeedTarget
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import {
  centsToAmount,
  parseDbInt,
  normalizeSponsorFeedStatus
} from './contributions-persistence-helpers.js';
import type { PublicSponsorshipPagination } from './public-sponsorship-pagination.js';
import { listPublicSponsorMediaByContributionIds } from './sponsor-media.repository.js';
import {
  normalizeSponsorFeedTarget,
  parseSponsorFeedChannels
} from './sponsorship-persistence-helpers.js';
import { SPONSOR_WEBSITE_VISIBLE_SQL } from './sponsorship-website-eligibility.js';
interface PublicSponsorshipRow {
  readonly contribution_id: string;
  readonly public_slug: string | null;
  readonly company_name: string;
  readonly website_url: string | null;
  readonly logo_url: string | null;
  readonly message: string | null;
  readonly public_summary: string | null;
  readonly amount: string | null;
  readonly currency: string;
  readonly paid_at: string | null;
  readonly feed_target: SponsorFeedTarget | null;
  readonly feed_channels: unknown;
  readonly feed_status: SponsorFeedStatus | null;
  readonly feed_public_url: string | null;
  readonly visibility_updated_at: string | null;
  readonly updated_at: string;
}

interface SponsorshipPublicationPresenceRow {
  readonly has_fund_contributions: boolean;
  readonly has_sponsor_review_status: boolean;
  readonly has_sponsor_publication_columns: boolean;
  readonly has_sponsor_media_assets: boolean;
}

const getSponsorshipPublicationPresence = async (
  pool: Pool
): Promise<SponsorshipPublicationPresenceRow> => {
  const query = await pool.query<SponsorshipPublicationPresenceRow>(`
    SELECT
      to_regclass('public.fund_contributions') IS NOT NULL AS has_fund_contributions,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fund_contributions'
          AND column_name = 'sponsor_review_status'
      ) AS has_sponsor_review_status,
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fund_contributions'
          AND column_name IN (
            'sponsor_public_slug',
            'sponsor_public_summary',
            'sponsor_feed_target',
            'sponsor_feed_channels',
            'sponsor_feed_status',
            'sponsor_feed_public_url',
            'sponsor_visibility_updated_at'
          )
      ) = 7 AS has_sponsor_publication_columns,
      to_regclass('public.sponsor_media_assets') IS NOT NULL AS has_sponsor_media_assets
  `);

  return (
    query.rows[0] ?? {
      has_fund_contributions: false,
      has_sponsor_review_status: false,
      has_sponsor_publication_columns: false,
      has_sponsor_media_assets: false
    }
  );
};

export const listPublicSponsorships = async (
  pool: Pool | null,
  { page = 1, pageSize = 50 }: Partial<PublicSponsorshipPagination> = {}
): Promise<PublicSponsorshipsResponse> => {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100_000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50
  ) {
    throw new RangeError('Invalid public sponsorship pagination');
  }
  const now = new Date().toISOString();

  if (!pool) {
    return {
      data_source: 'empty',
      sponsorships: [],
      last_updated_at: now
    };
  }

  const presence = await getSponsorshipPublicationPresence(pool);
  if (
    !presence.has_fund_contributions ||
    !presence.has_sponsor_review_status ||
    !presence.has_sponsor_publication_columns ||
    !presence.has_sponsor_media_assets
  ) {
    return {
      data_source: 'empty',
      sponsorships: [],
      last_updated_at: now
    };
  }

  // Page and totals share one database statement/snapshot and eligibility rule.
  const query = await pool.query<
    PublicSponsorshipRow & {
      readonly total_count: string;
      readonly published_count: string;
      readonly last_updated_at: string | null;
    }
  >(
    `
    WITH eligible AS (
    SELECT
      id AS contribution_id,
      sponsor_public_slug AS public_slug,
      sponsor_company_name AS company_name,
      sponsor_website_url AS website_url,
      sponsor_logo_url AS logo_url,
      NULL::text AS message,
      sponsor_public_summary AS public_summary,
      CASE
        WHEN display_amount_consent IS TRUE THEN amount_cents::text
        ELSE NULL
      END AS amount,
      currency,
      paid_at::text AS paid_at,
      sponsor_feed_target AS feed_target,
      sponsor_feed_channels AS feed_channels,
      COALESCE(sponsor_feed_status, 'not_planned') AS feed_status,
      sponsor_feed_public_url AS feed_public_url,
      sponsor_visibility_updated_at::text AS visibility_updated_at,
      updated_at::text AS updated_at,
      COALESCE(sponsor_visibility_updated_at, sponsor_reviewed_at, paid_at, updated_at, created_at) AS sort_at
    FROM fund_contributions
    WHERE ${SPONSOR_WEBSITE_VISIBLE_SQL}
    ), totals AS (
      SELECT COUNT(*)::text AS total_count,
        COUNT(*) FILTER (WHERE feed_status = 'published' AND feed_public_url ~* '^https://')::text AS published_count,
        MAX(updated_at::timestamptz)::text AS last_updated_at
      FROM eligible
    ), selected_page AS (
      SELECT * FROM eligible
      ORDER BY sort_at DESC, contribution_id DESC
      LIMIT $1 OFFSET $2
    )
    SELECT selected_page.*, totals.*
    FROM totals LEFT JOIN selected_page ON TRUE
    ORDER BY selected_page.sort_at DESC, selected_page.contribution_id DESC
  `,
    [pageSize, (page - 1) * pageSize]
  );
  // A LEFT JOIN retains the totals even for an empty/out-of-range page.
  const rows = query.rows.filter((row) => row.contribution_id !== null);

  const mediaByContribution = await listPublicSponsorMediaByContributionIds(
    pool,
    rows.map((row) => row.contribution_id)
  );

  const sponsorships: readonly PublicSponsorshipProfile[] = rows.map((row) => {
    const media = mediaByContribution.get(row.contribution_id) ?? [];
    return {
      public_id: createHash('sha256')
        .update(`public-sponsor:${row.contribution_id}`)
        .digest('hex'),
      public_slug: row.public_slug,
      company_name: row.company_name,
      website_url: row.website_url,
      logo_url:
        media.find((asset) => asset.kind === 'logo')?.url ?? row.logo_url,
      media,
      // Keep the legacy response key without exposing private follow-up notes.
      message: null,
      public_summary: row.public_summary,
      amount: row.amount ? centsToAmount(parseDbInt(row.amount)) : null,
      currency: row.currency.toUpperCase(),
      paid_at: row.paid_at,
      feed_target: normalizeSponsorFeedTarget(row.feed_target),
      feed_channels: parseSponsorFeedChannels(row.feed_channels),
      feed_status: normalizeSponsorFeedStatus(row.feed_status),
      feed_public_url:
        row.feed_status === 'published' ? row.feed_public_url : null,
      visibility_updated_at: row.visibility_updated_at
    };
  });

  return {
    data_source: 'database',
    sponsorships,
    last_updated_at: query.rows[0]?.last_updated_at ?? now,
    pagination: {
      page,
      page_size: pageSize,
      total_count: Number(query.rows[0]?.total_count ?? 0),
      published_count: Number(query.rows[0]?.published_count ?? 0)
    }
  };
};
