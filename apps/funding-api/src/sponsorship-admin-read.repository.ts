import type {
  AdminAuditLogEntry,
  AdminPagination,
  AdminSponsorshipStripeRefundReason,
  AdminSponsorshipRefundWorkflowStatus,
  AdminSponsorshipRecord,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget,
  SponsorshipReviewStatus
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  centsToAmount,
  parseDbInt,
  normalizeSponsorFeedStatus,
  normalizeSponsorshipReviewStatus
} from './contributions-persistence-helpers.js';
import {
  normalizeSponsorFeedTarget,
  parseSponsorFeedChannels,
  normalizeSponsorshipRefundWorkflowStatus,
  normalizeSponsorshipStripeRefundReason
} from './sponsorship-persistence-helpers.js';
export interface AdminSponsorshipListInput {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly reviewStatus?: SponsorshipReviewStatus;
  readonly feedStatus?: SponsorFeedStatus;
  readonly paymentStatus?: 'paid' | 'refunded' | 'disputed';
  readonly sort?:
    | 'priority'
    | 'paid_at'
    | 'submitted_at'
    | 'amount'
    | 'company'
    | 'updated_at';
  readonly direction?: 'asc' | 'desc';
}

export interface AdminSponsorshipListResult {
  readonly items: readonly AdminSponsorshipRecord[];
  readonly pagination: AdminPagination;
  readonly lastUpdatedAt: string;
}

interface AdminSponsorshipRow {
  readonly id: string;
  readonly version: string;
  readonly public_reference: string | null;
  readonly contribution_type: 'sponsorship_interest';
  readonly amount_cents: string;
  readonly currency: string;
  readonly payment_status: string;
  readonly paid_at: string | null;
  readonly public_name: string | null;
  readonly public_display_consent: boolean;
  readonly display_amount_consent: boolean;
  readonly sponsor_company_name: string | null;
  readonly sponsor_contact_name: string | null;
  readonly sponsor_contact_email: string | null;
  readonly sponsor_website_url: string | null;
  readonly sponsor_logo_url: string | null;
  readonly sponsor_message: string | null;
  readonly sponsor_details_submitted_at: string | null;
  readonly sponsor_review_status: SponsorshipReviewStatus;
  readonly sponsor_review_note: string | null;
  readonly sponsor_reviewed_at: string | null;
  readonly sponsor_public_slug: string | null;
  readonly sponsor_public_summary: string | null;
  readonly sponsor_feed_target: SponsorFeedTarget | null;
  readonly sponsor_feed_channels: unknown;
  readonly sponsor_feed_status: SponsorFeedStatus | null;
  readonly sponsor_feed_public_url: string | null;
  readonly sponsor_feed_notes: string | null;
  readonly sponsor_visibility_updated_at: string | null;
  readonly sponsorship_refund_status: AdminSponsorshipRefundWorkflowStatus | null;
  readonly sponsorship_refund_requested_at: string | null;
  readonly sponsorship_refund_processed_at: string | null;
  readonly sponsorship_refund_completed_at: string | null;
  readonly sponsorship_refund_id: string | null;
  readonly sponsorship_refund_amount_cents: string | null;
  readonly sponsorship_refund_reason: AdminSponsorshipStripeRefundReason | null;
  readonly sponsorship_refund_note: string | null;
  readonly sponsorship_refund_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SponsorshipAuditLogRow {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string | null;
  readonly summary: string | null;
  readonly metadata: unknown;
  readonly created_at: string;
}

const mapAdminSponsorshipRow = (
  row: AdminSponsorshipRow,
  adminAuditEntries: readonly AdminAuditLogEntry[] = []
): AdminSponsorshipRecord => ({
  id: row.id,
  version: row.version,
  public_reference: row.public_reference,
  contribution_type: row.contribution_type,
  amount: centsToAmount(parseDbInt(row.amount_cents)),
  currency: row.currency.toUpperCase(),
  payment_status: row.payment_status,
  paid_at: row.paid_at,
  public_name: row.public_name,
  public_display_consent: row.public_display_consent,
  display_amount_consent: row.display_amount_consent,
  sponsor_company_name: row.sponsor_company_name,
  sponsor_contact_name: row.sponsor_contact_name,
  sponsor_contact_email: row.sponsor_contact_email,
  sponsor_website_url: row.sponsor_website_url,
  sponsor_logo_url: row.sponsor_logo_url,
  sponsor_message: row.sponsor_message,
  sponsor_details_submitted_at: row.sponsor_details_submitted_at,
  sponsor_review_status: row.sponsor_review_status,
  sponsor_review_note: row.sponsor_review_note,
  sponsor_reviewed_at: row.sponsor_reviewed_at,
  sponsor_public_slug: row.sponsor_public_slug,
  sponsor_public_summary: row.sponsor_public_summary,
  sponsor_feed_target: normalizeSponsorFeedTarget(row.sponsor_feed_target),
  sponsor_feed_channels: parseSponsorFeedChannels(row.sponsor_feed_channels),
  sponsor_feed_status: normalizeSponsorFeedStatus(row.sponsor_feed_status),
  sponsor_feed_public_url: row.sponsor_feed_public_url,
  sponsor_feed_notes: row.sponsor_feed_notes,
  sponsor_visibility_updated_at: row.sponsor_visibility_updated_at,
  sponsorship_refund_status: normalizeSponsorshipRefundWorkflowStatus(
    row.sponsorship_refund_status,
    row.payment_status
  ),
  sponsorship_refund_requested_at: row.sponsorship_refund_requested_at,
  sponsorship_refund_processed_at: row.sponsorship_refund_processed_at,
  sponsorship_refund_completed_at: row.sponsorship_refund_completed_at,
  sponsorship_refund_id: row.sponsorship_refund_id,
  sponsorship_refund_amount: row.sponsorship_refund_amount_cents
    ? centsToAmount(parseDbInt(row.sponsorship_refund_amount_cents))
    : null,
  sponsorship_refund_reason: normalizeSponsorshipStripeRefundReason(
    row.sponsorship_refund_reason
  ),
  sponsorship_refund_note: row.sponsorship_refund_note,
  sponsorship_refund_error: row.sponsorship_refund_error,
  admin_audit_entries: adminAuditEntries,
  created_at: row.created_at,
  updated_at: row.updated_at
});

const mapSponsorshipAuditLogRow = (
  row: SponsorshipAuditLogRow
): AdminAuditLogEntry => ({
  id: row.id,
  actor: row.actor,
  action: row.action,
  entity_type: row.entity_type,
  entity_id: row.entity_id,
  summary: row.summary,
  metadata:
    typeof row.metadata === 'object' && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {},
  created_at: row.created_at
});

const hasAdminAuditLog = async (pool: Pool): Promise<boolean> => {
  const query = await pool.query<{ readonly has_admin_audit_log: boolean }>(`
    SELECT to_regclass('public.admin_audit_log') IS NOT NULL AS has_admin_audit_log
  `);

  return query.rows[0]?.has_admin_audit_log ?? false;
};

const listAdminSponsorshipAuditEntries = async (
  pool: Pool,
  contributionIds: readonly string[]
): Promise<Map<string, readonly AdminAuditLogEntry[]>> => {
  if (contributionIds.length === 0 || !(await hasAdminAuditLog(pool))) {
    return new Map();
  }

  const query = await pool.query<SponsorshipAuditLogRow>(
    `
      WITH ranked_audit AS (
        SELECT
          id::text AS id,
          actor,
          action,
          entity_type,
          entity_id,
          summary,
          metadata,
          created_at::text AS created_at,
          ROW_NUMBER() OVER (
            PARTITION BY entity_id
            ORDER BY created_at DESC
          ) AS audit_rank
        FROM admin_audit_log
        WHERE entity_type = 'sponsorship'
          AND entity_id = ANY($1::text[])
      )
      SELECT
        id,
        actor,
        action,
        entity_type,
        entity_id,
        summary,
        metadata,
        created_at
      FROM ranked_audit
      WHERE audit_rank <= 20
      ORDER BY created_at DESC
    `,
    [contributionIds]
  );

  const grouped = new Map<string, AdminAuditLogEntry[]>();
  for (const row of query.rows) {
    if (!row.entity_id) {
      continue;
    }

    const entries = grouped.get(row.entity_id) ?? [];
    entries.push(mapSponsorshipAuditLogRow(row));
    grouped.set(row.entity_id, entries);
  }

  return grouped;
};

const adminSponsorshipListOrderBy = (
  sort: NonNullable<AdminSponsorshipListInput['sort']>,
  direction: NonNullable<AdminSponsorshipListInput['direction']>
): string => {
  const sqlDirection = direction === 'asc' ? 'ASC' : 'DESC';

  if (sort === 'paid_at') {
    return `paid_at ${sqlDirection} NULLS LAST, updated_at DESC`;
  }

  if (sort === 'submitted_at') {
    return `sponsor_details_submitted_at ${sqlDirection} NULLS LAST, updated_at DESC`;
  }

  if (sort === 'amount') {
    return `amount_cents ${sqlDirection}, updated_at DESC`;
  }

  if (sort === 'company') {
    return `LOWER(COALESCE(sponsor_company_name, public_name, '')) ${sqlDirection}, updated_at DESC`;
  }

  if (sort === 'updated_at') {
    return `updated_at ${sqlDirection}`;
  }

  return `
    CASE COALESCE(sponsor_review_status, 'pending_review')
      WHEN 'pending_review' THEN 0
      WHEN 'approved' THEN 1
      ELSE 2
    END ASC,
    COALESCE(sponsor_details_submitted_at, paid_at, updated_at, created_at) DESC
  `;
};

export const listAdminSponsorships = async (
  pool: Pool | null,
  input: AdminSponsorshipListInput
): Promise<AdminSponsorshipListResult> => {
  const page = Math.max(1, input.page);
  const pageSize = input.pageSize;
  const emptyPagination: AdminPagination = {
    page,
    pageSize,
    totalItems: 0,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false
  };

  if (!pool) {
    return {
      items: [],
      pagination: emptyPagination,
      lastUpdatedAt: new Date().toISOString()
    };
  }

  const params: unknown[] = [];
  const whereClauses = [
    "contribution_type = 'sponsorship_interest'",
    "status IN ('paid', 'refunded', 'disputed')"
  ];

  const search = input.search?.trim();
  if (search && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(search)) {
    // Deep links use the contribution UUID to find a dossier across all pages.
    whereClauses.splice(1, 1); // Exact dossiers can also have an unconfirmed/cancelled payment.
    params.push(search);
    whereClauses.push(`id = $${params.length}::uuid`);
  } else if (search) {
    params.push(`%${search}%`);
    const placeholder = `$${params.length}`;
    whereClauses.push(`(
      sponsor_company_name ILIKE ${placeholder}
      OR sponsor_contact_name ILIKE ${placeholder}
      OR sponsor_contact_email ILIKE ${placeholder}
      OR sponsor_website_url ILIKE ${placeholder}
      OR public_reference ILIKE ${placeholder}
      OR public_name ILIKE ${placeholder}
      OR sponsor_public_slug ILIKE ${placeholder}
    )`);
  }

  if (input.reviewStatus) {
    params.push(input.reviewStatus);
    whereClauses.push(
      `COALESCE(sponsor_review_status, 'pending_review') = $${params.length}`
    );
  }

  if (input.feedStatus) {
    params.push(input.feedStatus);
    whereClauses.push(
      `COALESCE(sponsor_feed_status, 'not_planned') = $${params.length}`
    );
  }

  if (input.paymentStatus) {
    params.push(input.paymentStatus);
    whereClauses.push(`status = $${params.length}`);
  }

  const whereSql = whereClauses.join('\n      AND ');
  const countQuery = await pool.query<{
    readonly total_items: string;
    readonly last_updated_at: string | null;
  }>(
    `
      SELECT
        COUNT(*)::text AS total_items,
        MAX(updated_at)::text AS last_updated_at
      FROM fund_contributions
      WHERE ${whereSql}
    `,
    params
  );
  const totalItems = parseDbInt(countQuery.rows[0]?.total_items ?? '0');
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const normalizedPage = Math.min(page, totalPages);
  const offset = (normalizedPage - 1) * pageSize;

  params.push(pageSize, offset);
  const limitPlaceholder = `$${params.length - 1}`;
  const offsetPlaceholder = `$${params.length}`;
  const query = await pool.query<AdminSponsorshipRow>(
    `
    SELECT
      id::text AS id,
      updated_at::text AS version,
      public_reference,
      contribution_type,
      amount_cents::text AS amount_cents,
      currency,
      status AS payment_status,
      paid_at::text AS paid_at,
      public_name,
      public_display_consent,
      display_amount_consent,
      sponsor_company_name,
      sponsor_contact_name,
      sponsor_contact_email,
      sponsor_website_url,
      sponsor_logo_url,
      sponsor_message,
      sponsor_details_submitted_at::text AS sponsor_details_submitted_at,
      COALESCE(sponsor_review_status, 'pending_review') AS sponsor_review_status,
      sponsor_review_note,
      sponsor_reviewed_at::text AS sponsor_reviewed_at,
      sponsor_public_slug,
      sponsor_public_summary,
      sponsor_feed_target,
      sponsor_feed_channels,
      COALESCE(sponsor_feed_status, 'not_planned') AS sponsor_feed_status,
      sponsor_feed_public_url,
      sponsor_feed_notes,
      sponsor_visibility_updated_at::text AS sponsor_visibility_updated_at,
      COALESCE(sponsorship_refund_status, 'not_requested') AS sponsorship_refund_status,
      sponsorship_refund_requested_at::text AS sponsorship_refund_requested_at,
      sponsorship_refund_processed_at::text AS sponsorship_refund_processed_at,
      sponsorship_refund_completed_at::text AS sponsorship_refund_completed_at,
      sponsorship_refund_id,
      sponsorship_refund_amount_cents::text AS sponsorship_refund_amount_cents,
      sponsorship_refund_reason,
      sponsorship_refund_note,
      sponsorship_refund_error,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM fund_contributions
    WHERE ${whereSql}
    ORDER BY ${adminSponsorshipListOrderBy(
      input.sort ?? 'priority',
      input.direction ?? 'desc'
    )}
    LIMIT ${limitPlaceholder}
    OFFSET ${offsetPlaceholder}
  `,
    params
  );
  const auditEntriesByContribution = await listAdminSponsorshipAuditEntries(
    pool,
    query.rows.map((row) => row.id)
  );

  return {
    items: query.rows.map((row) =>
      mapAdminSponsorshipRow(row, auditEntriesByContribution.get(row.id) ?? [])
    ),
    pagination: {
      page: normalizedPage,
      pageSize,
      totalItems,
      totalPages,
      hasPreviousPage: normalizedPage > 1,
      hasNextPage: normalizedPage < totalPages
    },
    lastUpdatedAt:
      countQuery.rows[0]?.last_updated_at ?? new Date().toISOString()
  };
};

/**
 * Minimal, privacy-preserving projection of every paid/refunded/disputed
 * sponsorship, used by the read-only admin assistant to build a GLOBAL
 * attention queue (never a single paginated page). Company names, contact
 * emails and website URLs are collapsed to presence booleans inside SQL so the
 * raw personal data never leaves the database layer.
 */
export interface SponsorshipAttentionRecord {
  readonly contributionId: string;
  readonly publicReference: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly paymentStatus: string;
  readonly paidAt: string | null;
  readonly updatedAt: string;
  readonly detailsSubmittedAt: string | null;
  readonly hasCompanyName: boolean;
  readonly hasContactEmail: boolean;
  readonly hasWebsite: boolean;
  readonly hasLogo: boolean;
  readonly hasSupportingImage: boolean;
  readonly reviewStatus: SponsorshipReviewStatus;
  readonly feedStatus: SponsorFeedStatus;
  readonly feedTarget: SponsorFeedTarget | null;
  readonly feedChannels: readonly SponsorFeedChannel[];
  readonly refundStatus: AdminSponsorshipRefundWorkflowStatus;
}

export interface SponsorshipAttentionQueryResult {
  readonly items: readonly SponsorshipAttentionRecord[];
  readonly lastUpdatedAt: string;
  readonly truncated: boolean;
}

interface SponsorshipAttentionRow {
  readonly contribution_id: string;
  readonly public_reference: string | null;
  readonly amount_cents: string;
  readonly currency: string;
  readonly payment_status: string;
  readonly paid_at: string | null;
  readonly updated_at: string;
  readonly sponsor_details_submitted_at: string | null;
  readonly has_company_name: boolean;
  readonly has_contact_email: boolean;
  readonly has_website: boolean;
  readonly has_logo: boolean;
  readonly has_supporting_image: boolean;
  readonly sponsor_review_status: SponsorshipReviewStatus;
  readonly sponsor_feed_status: SponsorFeedStatus;
  readonly sponsor_feed_target: SponsorFeedTarget | null;
  readonly sponsor_feed_channels: unknown;
  readonly sponsorship_refund_status: AdminSponsorshipRefundWorkflowStatus;
}

const SPONSORSHIP_ATTENTION_MAX_ROWS = 2000;

/** Lock the sponsorship dossier in the caller's transaction, before any write. */

export const listSponsorshipsForAttention = async (
  pool: Pool | PoolClient | null,
  maxRows: number | null = SPONSORSHIP_ATTENTION_MAX_ROWS,
  reference?: string
): Promise<SponsorshipAttentionQueryResult> => {
  if (!pool) {
    return {
      items: [],
      lastUpdatedAt: new Date().toISOString(),
      truncated: false
    };
  }

  const cap =
    maxRows === null
      ? null
      : Math.max(1, Math.min(maxRows, SPONSORSHIP_ATTENTION_MAX_ROWS));
  const mediaPresence = await pool.query<{ readonly exists: boolean }>(
    `SELECT to_regclass('public.sponsor_media_assets') IS NOT NULL AS exists`
  );
  const supportingImageProjection = mediaPresence.rows[0]?.exists
    ? `EXISTS (
         SELECT 1
         FROM sponsor_media_assets AS media
         WHERE media.contribution_id = fund_contributions.id
           AND media.kind = 'supporting_image'
           AND media.deleted_at IS NULL
       )`
    : 'FALSE';
  const query = await pool.query<SponsorshipAttentionRow>(
    `
    SELECT
      id::text AS contribution_id,
      public_reference,
      amount_cents::text AS amount_cents,
      currency,
      status AS payment_status,
      paid_at::text AS paid_at,
      updated_at::text AS updated_at,
      sponsor_details_submitted_at::text AS sponsor_details_submitted_at,
      (COALESCE(TRIM(sponsor_company_name), '') <> '') AS has_company_name,
      (COALESCE(TRIM(sponsor_contact_email), '') <> '') AS has_contact_email,
      (COALESCE(TRIM(sponsor_website_url), '') <> '') AS has_website,
      (COALESCE(TRIM(sponsor_logo_url), '') <> '') AS has_logo,
      ${supportingImageProjection} AS has_supporting_image,
      COALESCE(sponsor_review_status, 'pending_review') AS sponsor_review_status,
      COALESCE(sponsor_feed_status, 'not_planned') AS sponsor_feed_status,
      sponsor_feed_target,
      sponsor_feed_channels,
      COALESCE(sponsorship_refund_status, 'not_requested') AS sponsorship_refund_status
    FROM fund_contributions
    WHERE contribution_type = 'sponsorship_interest'
      AND ($2::text IS NOT NULL OR status IN ('paid', 'refunded', 'disputed'))
      AND ($2::text IS NULL OR id::text = $2 OR public_reference = $2)
    ORDER BY updated_at DESC
    LIMIT $1
  `,
    [cap === null ? null : cap + 1, reference ?? null]
  );

  const truncated = cap !== null && query.rows.length > cap;
  const rows = truncated ? query.rows.slice(0, cap ?? undefined) : query.rows;
  const items = rows.map((row): SponsorshipAttentionRecord => ({
    contributionId: row.contribution_id,
    publicReference: row.public_reference,
    amount: centsToAmount(parseDbInt(row.amount_cents)),
    currency: row.currency.toUpperCase(),
    paymentStatus: row.payment_status,
    paidAt: row.paid_at,
    updatedAt: row.updated_at,
    detailsSubmittedAt: row.sponsor_details_submitted_at,
    hasCompanyName: row.has_company_name,
    hasContactEmail: row.has_contact_email,
    hasWebsite: row.has_website,
    hasLogo: row.has_logo,
    hasSupportingImage: row.has_supporting_image,
    reviewStatus:
      normalizeSponsorshipReviewStatus(row.sponsor_review_status) ??
      'pending_review',
    feedStatus: normalizeSponsorFeedStatus(row.sponsor_feed_status),
    feedTarget: normalizeSponsorFeedTarget(row.sponsor_feed_target),
    feedChannels: parseSponsorFeedChannels(row.sponsor_feed_channels),
    refundStatus: normalizeSponsorshipRefundWorkflowStatus(
      row.sponsorship_refund_status,
      row.payment_status
    )
  }));

  const lastUpdatedAt = items[0]?.updatedAt ?? new Date().toISOString();
  return { items, lastUpdatedAt, truncated };
};

export const getAdminSponsorshipById = async (
  pool: Pool | null,
  contributionId: string
): Promise<AdminSponsorshipRecord | null> => {
  if (!pool) {
    return null;
  }

  const query = await pool.query<AdminSponsorshipRow>(
    `
      SELECT
        id::text AS id,
        updated_at::text AS version,
        public_reference,
        contribution_type,
        amount_cents::text AS amount_cents,
        currency,
        status AS payment_status,
        paid_at::text AS paid_at,
        public_name,
        public_display_consent,
        display_amount_consent,
        sponsor_company_name,
        sponsor_contact_name,
        sponsor_contact_email,
        sponsor_website_url,
        sponsor_logo_url,
        sponsor_message,
        sponsor_details_submitted_at::text AS sponsor_details_submitted_at,
        COALESCE(sponsor_review_status, 'pending_review') AS sponsor_review_status,
        sponsor_review_note,
        sponsor_reviewed_at::text AS sponsor_reviewed_at,
        sponsor_public_slug,
        sponsor_public_summary,
        sponsor_feed_target,
        sponsor_feed_channels,
        COALESCE(sponsor_feed_status, 'not_planned') AS sponsor_feed_status,
        sponsor_feed_public_url,
        sponsor_feed_notes,
        sponsor_visibility_updated_at::text AS sponsor_visibility_updated_at,
        COALESCE(sponsorship_refund_status, 'not_requested') AS sponsorship_refund_status,
        sponsorship_refund_requested_at::text AS sponsorship_refund_requested_at,
        sponsorship_refund_processed_at::text AS sponsorship_refund_processed_at,
        sponsorship_refund_completed_at::text AS sponsorship_refund_completed_at,
        sponsorship_refund_id,
        sponsorship_refund_amount_cents::text AS sponsorship_refund_amount_cents,
        sponsorship_refund_reason,
        sponsorship_refund_note,
        sponsorship_refund_error,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM fund_contributions
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
      LIMIT 1
    `,
    [contributionId]
  );

  const row = query.rows[0];
  if (!row) {
    return null;
  }

  const auditEntriesByContribution = await listAdminSponsorshipAuditEntries(
    pool,
    [row.id]
  );

  return mapAdminSponsorshipRow(
    row,
    auditEntriesByContribution.get(row.id) ?? []
  );
};

export const getAdminSponsorshipLogoUrl = async (
  pool: Pool | null,
  contributionId: string
): Promise<string | null> => {
  if (!pool) {
    return null;
  }

  const result = await pool.query<{ readonly sponsor_logo_url: string | null }>(
    `
      SELECT sponsor_logo_url
      FROM fund_contributions
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
    `,
    [contributionId]
  );

  return result.rows[0]?.sponsor_logo_url ?? null;
};

export const isPublicApprovedSponsorshipLogoUrl = async (
  pool: Pool | null,
  logoUrl: string
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const query = await pool.query<{ readonly exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM fund_contributions
        WHERE contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
          AND public_display_consent = TRUE
          AND sponsor_review_status = 'approved'
          AND COALESCE((to_jsonb(fund_contributions)->>'sponsor_site_visibility_held')::boolean,FALSE) IS FALSE
          AND sponsor_logo_url = $1
      ) AS exists
    `,
    [logoUrl]
  );

  return query.rows[0]?.exists ?? false;
};
