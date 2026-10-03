import type { AdminDashboardResponse } from '@openg7/funding-core';
import type { Pool } from 'pg';

import {
  getAdminContributionsSummary,
  listRecentAdminContributions
} from './contributions-read.repository.js';
import { parseDbInt } from './contributions-persistence-helpers.js';

interface AdminSponsorshipReviewSummaryRow {
  readonly total: string;
  readonly pending: string;
  readonly approved: string;
  readonly rejected: string;
}

interface AdminFeedPublicationSummaryRow {
  readonly planned: string;
  readonly drafted: string;
  readonly published: string;
  readonly active: string;
}

interface AdminStripeEventSummaryRow {
  readonly failed: string;
  readonly processing: string;
  readonly last_failed_at: string | null;
}

const getAdminSponsorshipReviewSummary = async (
  pool: Pool | null
): Promise<AdminDashboardResponse['sponsorship_review']> => {
  if (!pool) {
    return {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0
    };
  }

  const query = await pool.query<AdminSponsorshipReviewSummaryRow>(`
    SELECT
      COUNT(*)::text AS total,
      COALESCE(SUM(CASE WHEN COALESCE(sponsor_review_status, 'pending_review') = 'pending_review' THEN 1 ELSE 0 END), 0)::text AS pending,
      COALESCE(SUM(CASE WHEN sponsor_review_status = 'approved' THEN 1 ELSE 0 END), 0)::text AS approved,
      COALESCE(SUM(CASE WHEN sponsor_review_status = 'rejected' THEN 1 ELSE 0 END), 0)::text AS rejected
    FROM fund_contributions
    WHERE contribution_type = 'sponsorship_interest'
      AND status IN ('paid', 'refunded', 'disputed')
  `);

  const row = query.rows[0];
  return {
    total: parseDbInt(row?.total ?? '0'),
    pending: parseDbInt(row?.pending ?? '0'),
    approved: parseDbInt(row?.approved ?? '0'),
    rejected: parseDbInt(row?.rejected ?? '0')
  };
};

const getAdminFeedPublicationSummary = async (
  pool: Pool | null
): Promise<AdminDashboardResponse['feed_publication']> => {
  if (!pool) {
    return {
      planned: 0,
      drafted: 0,
      published: 0,
      active: 0
    };
  }

  const query = await pool.query<AdminFeedPublicationSummaryRow>(`
    SELECT
      COALESCE(SUM(CASE WHEN sponsor_feed_status = 'planned' THEN 1 ELSE 0 END), 0)::text AS planned,
      COALESCE(SUM(CASE WHEN sponsor_feed_status = 'drafted' THEN 1 ELSE 0 END), 0)::text AS drafted,
      COALESCE(SUM(CASE WHEN sponsor_feed_status = 'published' THEN 1 ELSE 0 END), 0)::text AS published,
      COALESCE(SUM(CASE WHEN sponsor_feed_status IN ('planned', 'drafted', 'published') THEN 1 ELSE 0 END), 0)::text AS active
    FROM fund_contributions
    WHERE contribution_type = 'sponsorship_interest'
      AND status IN ('paid', 'refunded', 'disputed')
  `);

  const row = query.rows[0];
  return {
    planned: parseDbInt(row?.planned ?? '0'),
    drafted: parseDbInt(row?.drafted ?? '0'),
    published: parseDbInt(row?.published ?? '0'),
    active: parseDbInt(row?.active ?? '0')
  };
};

const getAdminStripeEventSummary = async (
  pool: Pool | null
): Promise<AdminDashboardResponse['stripe_events']> => {
  if (!pool) {
    return {
      failed: 0,
      processing: 0,
      last_failed_at: null
    };
  }

  const query = await pool.query<AdminStripeEventSummaryRow>(`
    SELECT
      COALESCE(SUM(CASE WHEN processing_status = 'failed' THEN 1 ELSE 0 END), 0)::text AS failed,
      COALESCE(SUM(CASE WHEN processing_status = 'processing' THEN 1 ELSE 0 END), 0)::text AS processing,
      MAX(CASE WHEN processing_status = 'failed' THEN received_at ELSE NULL END)::text AS last_failed_at
    FROM stripe_events
  `);

  const row = query.rows[0];
  return {
    failed: parseDbInt(row?.failed ?? '0'),
    processing: parseDbInt(row?.processing ?? '0'),
    last_failed_at: row?.last_failed_at ?? null
  };
};

export const getAdminDashboard = async (
  pool: Pool | null
): Promise<AdminDashboardResponse> => {
  const [
    { summary, lastUpdatedAt },
    sponsorshipReview,
    feedPublication,
    stripeEvents,
    recentContributions
  ] = await Promise.all([
    getAdminContributionsSummary(pool),
    getAdminSponsorshipReviewSummary(pool),
    getAdminFeedPublicationSummary(pool),
    getAdminStripeEventSummary(pool),
    listRecentAdminContributions(pool, 8)
  ]);

  const currentAvailableEstimate = Number(
    (
      summary.total_received -
      summary.total_refunded -
      summary.total_disputed
    ).toFixed(2)
  );

  return {
    data_source: 'database',
    totals: {
      total_received: summary.total_received,
      total_refunded: summary.total_refunded,
      total_disputed: summary.total_disputed,
      current_available_estimate: currentAvailableEstimate,
      currency: summary.currency,
      contributions_count: summary.total_count,
      paid_contributions_count: summary.paid_count
    },
    data_available: pool !== null,
    sponsorship_review: sponsorshipReview,
    feed_publication: feedPublication,
    stripe_events: stripeEvents,
    recent_contributions: recentContributions,
    last_updated_at: lastUpdatedAt
  };
};
