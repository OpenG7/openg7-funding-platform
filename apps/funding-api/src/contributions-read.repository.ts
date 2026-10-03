import type {
  AdminContributionRecord,
  AdminContributionsResponse,
  AdminContributionsSummary,
  PublicReferenceLookupFoundResponse,
  PublicReferenceLookupNextStep
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { getAdjustmentTotals } from './fund-transparency.repository.js';
import { resolveRefundedAmountMinor } from './fund-refunds.js';
import {
  centsToAmount,
  parseDbInt
} from './contributions-persistence-helpers.js';
import { mapAdminContributionRow } from './contributions-persistence-mappers.js';
import type {
  AdminContributionRow,
  ContributionReferenceRecoveryRecord,
  ContributionReferenceRecoveryRow,
  PublicReferenceLookupRow
} from './contributions-persistence-mappers.js';

interface AdminContributionsSummaryRow {
  readonly total_count: string;
  readonly paid_count: string;
  readonly pending_count: string;
  readonly sponsorship_count: string;
  readonly public_display_count: string;
  readonly total_received: string;
  readonly total_refunded: string;
  readonly total_disputed: string;
  readonly currency: string;
  readonly last_updated_at: string;
}

const emptyAdminContributionsSummary = (): AdminContributionsSummary => ({
  total_count: 0,
  paid_count: 0,
  pending_count: 0,
  sponsorship_count: 0,
  public_display_count: 0,
  total_received: 0,
  total_refunded: 0,
  total_disputed: 0,
  currency: 'CAD'
});

export const getAdminContributionsSummary = async (
  pool: Pool | null
): Promise<{
  readonly summary: AdminContributionsSummary;
  readonly lastUpdatedAt: string;
}> => {
  const now = new Date().toISOString();

  if (!pool) {
    return {
      summary: emptyAdminContributionsSummary(),
      lastUpdatedAt: now
    };
  }

  const query = await pool.query<AdminContributionsSummaryRow>(`
    SELECT
      COUNT(*)::text AS total_count,
      COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded', 'disputed') THEN 1 ELSE 0 END), 0)::text AS paid_count,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)::text AS pending_count,
      COALESCE(SUM(CASE WHEN contribution_type = 'sponsorship_interest' THEN 1 ELSE 0 END), 0)::text AS sponsorship_count,
      COALESCE(SUM(CASE WHEN public_display_consent IS TRUE THEN 1 ELSE 0 END), 0)::text AS public_display_count,
      COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded', 'disputed') THEN amount_cents ELSE 0 END), 0)::text AS total_received,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_cents ELSE 0 END), 0)::text AS total_refunded,
      COALESCE(SUM(CASE WHEN status = 'disputed' THEN amount_cents ELSE 0 END), 0)::text AS total_disputed,
      COALESCE(MAX(currency), 'cad') AS currency,
      COALESCE(MAX(updated_at), NOW())::text AS last_updated_at
    FROM fund_contributions
  `);

  const row = query.rows[0];
  if (!row) {
    return {
      summary: emptyAdminContributionsSummary(),
      lastUpdatedAt: now
    };
  }

  const adjustments = await getAdjustmentTotals(pool, true);
  const refundedAmountMinor = resolveRefundedAmountMinor(
    parseDbInt(adjustments.total_refunded),
    parseDbInt(row.total_refunded)
  );
  const lastUpdatedAt =
    adjustments.last_updated_at &&
    new Date(adjustments.last_updated_at) > new Date(row.last_updated_at)
      ? adjustments.last_updated_at
      : row.last_updated_at;

  return {
    summary: {
      total_count: parseDbInt(row.total_count),
      paid_count: parseDbInt(row.paid_count),
      pending_count: parseDbInt(row.pending_count),
      sponsorship_count: parseDbInt(row.sponsorship_count),
      public_display_count: parseDbInt(row.public_display_count),
      total_received: centsToAmount(parseDbInt(row.total_received)),
      total_refunded: centsToAmount(refundedAmountMinor),
      total_disputed: centsToAmount(parseDbInt(row.total_disputed)),
      currency: row.currency.toUpperCase()
    },
    lastUpdatedAt
  };
};

export const listRecentAdminContributions = async (
  pool: Pool | PoolClient | null,
  limit: number,
  contributionIds?: readonly string[],
  lock = false
): Promise<readonly AdminContributionRecord[]> => {
  if (!pool) {
    return [];
  }

  const query = await pool.query<AdminContributionRow>(
    `
      SELECT
        id::text AS id,
        public_reference,
        contribution_type,
        amount_cents::text AS amount_cents,
        currency,
        status AS payment_status,
        paid_at::text AS paid_at,
        public_name,
        email_private,
        public_display_consent,
        display_amount_consent,
        non_charity_acknowledged,
        sponsor_company_name,
        sponsor_contact_name,
        sponsor_contact_email,
        CASE
          WHEN contribution_type = 'sponsorship_interest'
          THEN COALESCE(sponsor_review_status, 'pending_review')
          ELSE NULL
        END AS sponsor_review_status,
        CASE
          WHEN contribution_type = 'sponsorship_interest'
          THEN COALESCE(sponsor_feed_status, 'not_planned')
          ELSE NULL
        END AS sponsor_feed_status,
        stripe_session_id,
        stripe_payment_intent_id,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM fund_contributions
      WHERE ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
      ORDER BY COALESCE(paid_at, updated_at, created_at) DESC, id
      LIMIT $1
      ${lock ? 'FOR SHARE' : ''}
    `,
    [Math.max(1, Math.min(limit, 500)), contributionIds ?? null]
  );

  return query.rows.map(mapAdminContributionRow);
};

export const listAdminContributionSelection = (
  db: PoolClient,
  ids: readonly string[]
): Promise<readonly AdminContributionRecord[]> =>
  listRecentAdminContributions(db, 250, ids, true);

export const listAdminContributions = async (
  pool: Pool | null,
  contributionId?: string
): Promise<AdminContributionsResponse> => {
  const [{ summary, lastUpdatedAt }, contributions] = await Promise.all([
    getAdminContributionsSummary(pool),
    listRecentAdminContributions(
      pool,
      250,
      contributionId ? [contributionId] : undefined
    )
  ]);

  return {
    data_source: 'database',
    summary,
    contributions,
    last_updated_at: lastUpdatedAt
  };
};

const publicReferenceNextStep = (
  row: PublicReferenceLookupRow
): PublicReferenceLookupNextStep => {
  if (row.payment_status === 'pending' || row.payment_status === 'expired') {
    return 'wait_for_payment_confirmation';
  }

  if (row.payment_status === 'disputed') {
    return 'contact_support_with_reference';
  }

  if (row.contribution_type === 'sponsorship_interest') {
    return 'recover_private_link_by_email';
  }

  return 'none';
};

export const lookupPublicContributionReference = async (
  pool: Pool | null,
  publicReference: string
): Promise<PublicReferenceLookupFoundResponse | null> => {
  if (!pool) {
    return null;
  }

  const query = await pool.query<PublicReferenceLookupRow>(
    `
      SELECT
        public_reference,
        contribution_type,
        amount_cents::text AS amount_cents,
        currency,
        status AS payment_status,
        display_amount_consent,
        paid_at::text AS paid_at,
        created_at::text AS created_at,
        CASE
          WHEN contribution_type = 'sponsorship_interest'
          THEN COALESCE(sponsor_review_status, 'pending_review')
          ELSE NULL
        END AS review_status,
        CASE
          WHEN contribution_type = 'sponsorship_interest'
          THEN sponsor_details_submitted_at IS NOT NULL
          ELSE NULL
        END AS details_submitted
      FROM fund_contributions
      WHERE public_reference = $1
      LIMIT 1
    `,
    [publicReference]
  );
  const row = query.rows[0] ?? null;

  if (!row) {
    return null;
  }

  const displayAmount = row.display_amount_consent === true;

  return {
    found: true,
    publicReference: row.public_reference,
    contributionType: row.contribution_type,
    paymentStatus: row.payment_status,
    amount: displayAmount ? centsToAmount(parseDbInt(row.amount_cents)) : null,
    displayAmount,
    currency: row.currency.toUpperCase(),
    paidAt: row.paid_at,
    createdAt: row.created_at,
    reviewStatus: row.review_status,
    detailsSubmitted: row.details_submitted,
    nextStep: publicReferenceNextStep(row)
  };
};

export const listContributionReferencesByEmail = async (
  pool: Pool | null,
  email: string
): Promise<readonly ContributionReferenceRecoveryRecord[]> => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!pool || !normalizedEmail) {
    return [];
  }

  const query = await pool.query<ContributionReferenceRecoveryRow>(
    `
      SELECT
        public_reference,
        contribution_type,
        amount_cents::text AS amount_cents,
        currency,
        status AS payment_status,
        paid_at::text AS paid_at,
        created_at::text AS created_at,
        COALESCE(
          NULLIF(TRIM(sponsor_company_name), ''),
          NULLIF(TRIM(public_name), '')
        ) AS display_name
      FROM fund_contributions
      WHERE public_reference IS NOT NULL
        AND (
          LOWER(COALESCE(email_private, '')) = $1
          OR LOWER(COALESCE(sponsor_contact_email, '')) = $1
        )
      ORDER BY COALESCE(paid_at, updated_at, created_at) DESC
      LIMIT 25
    `,
    [normalizedEmail]
  );

  return query.rows.map((row) => ({
    publicReference: row.public_reference,
    contributionType: row.contribution_type,
    amount: centsToAmount(parseDbInt(row.amount_cents)),
    currency: row.currency.toUpperCase(),
    paymentStatus: row.payment_status,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    displayName: row.display_name
  }));
};
