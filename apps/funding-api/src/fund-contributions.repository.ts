import { createHash } from 'node:crypto';

import type {
  AdminAuditLogEntry,
  AdminPagination,
  AdminSponsorshipStripeRefundReason,
  AdminSponsorshipRefundWorkflowStatus,
  AdminSponsorshipPublicationRequest,
  AdminSponsorshipRecord,
  PublicSponsorshipProfile,
  PublicSponsorshipsResponse,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget,
  SponsorshipFollowupResponse,
  SponsorshipReviewStatus
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { resolveSponsorshipBenefits } from '../../../packages/funding-core/src/index.js';

import { resolveSponsorshipSocialChannels } from './sponsorship-benefits.js';
import { SPONSOR_APPROVED_PRESENTATION_SQL } from './sponsorship-media-eligibility.js';
import { SPONSOR_WEBSITE_VISIBLE_SQL } from './sponsorship-website-eligibility.js';
import { listPublicSponsorMediaByContributionIds } from './sponsor-media.repository.js';
import type { PublicSponsorshipPagination } from './public-sponsorship-pagination.js';
import {
  centsToAmount,
  parseDbInt,
  normalizeSponsorFeedStatus,
  normalizeSponsorshipReviewStatus
} from './contributions-persistence-helpers.js';

export {
  allowedSponsorshipReviewStatuses,
  allowedSponsorFeedStatuses,
  normalizeContributionType,
  parseMetadataBoolean
} from './contributions-persistence-helpers.js';
export {
  listAdminContributionSelection,
  listAdminContributions,
  lookupPublicContributionReference,
  listContributionReferencesByEmail
} from './contributions-read.repository.js';
export {
  insertCheckoutSessionRecord,
  upsertCheckoutSessionFromWebhook,
  updateContributionStatusByPaymentIntent
} from './contributions-write.repository.js';
export type {
  CheckoutSessionRecordInput,
  CheckoutSessionWebhookInput,
  PaymentIntentStatusInput
} from './contributions-write.repository.js';
export { getAdminDashboard } from './contributions-dashboard.repository.js';
export type { ContributionReferenceRecoveryRecord } from './contributions-persistence-mappers.js';

export const allowedSponsorshipRefundWorkflowStatuses =
  new Set<AdminSponsorshipRefundWorkflowStatus>([
    'not_requested',
    'requested',
    'processing',
    'completed',
    'failed'
  ]);
export const allowedSponsorshipStripeRefundReasons =
  new Set<AdminSponsorshipStripeRefundReason>([
    'requested_by_customer',
    'duplicate',
    'fraudulent'
  ]);
export const allowedSponsorFeedTargets = new Set<SponsorFeedTarget>([
  'openg7',
  'openg20'
]);
export const allowedSponsorFeedChannels = new Set<SponsorFeedChannel>([
  'facebook',
  'linkedin'
]);
export interface StripeEventRecordInput {
  readonly stripeEventId: string;
  readonly eventType: string;
  readonly payload: unknown;
}

export interface SponsorshipDetailsRecordInput {
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly publicReference: string | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly publicDisplayConsent: boolean;
  readonly displayAmountConsent: boolean;
  readonly nonCharityAcknowledged: boolean;
  readonly paidAtIso: string | null;
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl: string | null;
  readonly logoUrl: string | null;
  readonly message: string | null;
}

export interface SponsorshipReviewInput {
  readonly contributionId: string;
  readonly reviewStatus: SponsorshipReviewStatus;
  readonly reviewNote: string | null;
  readonly expectedVersion: string;
}

export interface SponsorshipRefundTarget {
  readonly id: string;
  readonly version: string;
  readonly publicReference: string | null;
  readonly paymentStatus: string;
  readonly refundWorkflowStatus: AdminSponsorshipRefundWorkflowStatus;
  readonly refundId: string | null;
  readonly amountCents: number;
  readonly amount: number;
  readonly currency: string;
  readonly stripePaymentIntentId: string | null;
  readonly sponsorName: string;
}

export interface SponsorshipRefundWorkflowUpdateInput {
  readonly contributionId: string;
  readonly refundStatus: AdminSponsorshipRefundWorkflowStatus;
  readonly refundId?: string | null;
  readonly refundAmountCents?: number | null;
  readonly refundReason?: AdminSponsorshipStripeRefundReason | null;
  readonly refundNote?: string | null;
  readonly refundError?: string | null;
}

export interface SponsorshipRefundWorkflowUpdateByPaymentIntentInput {
  readonly stripePaymentIntentId: string;
  readonly refundStatus: AdminSponsorshipRefundWorkflowStatus;
  readonly refundId?: string | null;
  readonly refundAmountCents?: number | null;
  readonly refundReason?: AdminSponsorshipStripeRefundReason | null;
  readonly refundNote?: string | null;
  readonly refundError?: string | null;
}

export type SponsorshipPublicationInput = AdminSponsorshipPublicationRequest;

export type SponsorshipMutationStatus =
  | 'updated'
  | 'not_found'
  | 'conflict'
  | 'payment_not_eligible'
  | 'media_required';

export interface SponsorshipReviewMutationResult {
  readonly status: SponsorshipMutationStatus;
  readonly updated: boolean;
  readonly currentVersion: string | null;
  readonly paymentStatus: string | null;
}

export interface SponsorshipPublicationMutationResult {
  readonly status: SponsorshipMutationStatus;
  readonly updated: boolean;
  readonly feedChannels: readonly SponsorFeedChannel[];
  readonly currentVersion: string | null;
  readonly paymentStatus: string | null;
}

export interface SponsorshipLogoInput {
  readonly contributionId: string;
  readonly logoUrl: string;
  readonly expectedVersion: string;
}

export interface SponsorshipLogoMutationResult {
  readonly status: Exclude<
    SponsorshipMutationStatus,
    'payment_not_eligible' | 'media_required'
  >;
  readonly updated: boolean;
  readonly previousLogoUrl: string | null;
  readonly currentVersion: string | null;
}

export interface SponsorshipLogoDeleteInput {
  readonly contributionId: string;
  readonly expectedVersion: string;
}

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

export interface SponsorshipFollowupRecordInput {
  readonly contributionId: string;
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl: string | null;
  readonly logoUrl: string | null;
  readonly message: string | null;
}

export interface SponsorshipFollowupEmailRecordInput {
  readonly stripeSessionId: string;
  readonly sentAtIso?: string;
  readonly error: string | null;
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

interface SponsorshipFollowupRow {
  readonly id: string;
  readonly public_reference: string | null;
  readonly amount_cents: string;
  readonly currency: string;
  readonly payment_status: string;
  readonly paid_at: string | null;
  readonly sponsor_company_name: string | null;
  readonly sponsor_contact_name: string | null;
  readonly sponsor_contact_email: string | null;
  readonly sponsor_website_url: string | null;
  readonly sponsor_logo_url: string | null;
  readonly sponsor_message: string | null;
  readonly sponsor_details_submitted_at: string | null;
  readonly sponsor_review_status: SponsorshipReviewStatus;
  readonly sponsor_reviewed_at: string | null;
  readonly stripe_session_id: string | null;
  readonly stripe_payment_intent_id: string | null;
  readonly email_private: string | null;
  readonly sponsorship_followup_email_sent_at: string | null;
}

const parseSponsorFeedChannels = (
  value: unknown
): readonly SponsorFeedChannel[] => {
  let raw = value;

  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((channel): channel is SponsorFeedChannel =>
    allowedSponsorFeedChannels.has(channel as SponsorFeedChannel)
  );
};

const mergePromisedSponsorFeedChannels = (
  channels: readonly SponsorFeedChannel[],
  amount: number
): readonly SponsorFeedChannel[] => {
  const promisedChannels = resolveSponsorshipSocialChannels(amount);

  return [...new Set([...channels, ...promisedChannels])];
};

const normalizeSponsorFeedTarget = (
  value: SponsorFeedTarget | null
): SponsorFeedTarget | null =>
  value && allowedSponsorFeedTargets.has(value) ? value : null;

const normalizedNullableText = (
  value: string | null | undefined
): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const sponsorFeedChannelsEqual = (
  first: readonly SponsorFeedChannel[],
  second: readonly SponsorFeedChannel[]
): boolean => {
  const firstSet = new Set(first);
  const secondSet = new Set(second);

  return (
    firstSet.size === secondSet.size &&
    [...firstSet].every((channel) => secondSet.has(channel))
  );
};

const normalizeSponsorshipRefundWorkflowStatus = (
  value: AdminSponsorshipRefundWorkflowStatus | null,
  paymentStatus?: string
): AdminSponsorshipRefundWorkflowStatus => {
  if (value && allowedSponsorshipRefundWorkflowStatuses.has(value)) {
    return value;
  }

  return paymentStatus === 'refunded' ? 'completed' : 'not_requested';
};

const normalizeSponsorshipStripeRefundReason = (
  value: AdminSponsorshipStripeRefundReason | null
): AdminSponsorshipStripeRefundReason | null =>
  value && allowedSponsorshipStripeRefundReasons.has(value) ? value : null;

export const insertStripeEventRecord = async (
  pool: Pool | null,
  input: StripeEventRecordInput
): Promise<boolean> => {
  if (!pool) {
    return true;
  }

  const result = await pool.query(
    `
      INSERT INTO stripe_events (
        stripe_event_id,
        event_type,
        payload,
        processing_status,
        processed_at
      )
      VALUES ($1, $2, $3::jsonb, 'processing', NULL)
      ON CONFLICT (stripe_event_id) DO UPDATE
      SET
        payload = EXCLUDED.payload,
        processing_status = 'processing',
        processed_at = NULL
      WHERE stripe_events.processing_status = 'failed'
    `,
    [input.stripeEventId, input.eventType, JSON.stringify(input.payload)]
  );

  return result.rowCount === 1;
};

export const markStripeEventProcessed = async (
  pool: Pool | null,
  stripeEventId: string
): Promise<void> => {
  if (!pool) {
    return;
  }

  await pool.query(
    `
      UPDATE stripe_events
      SET
        processing_status = 'processed',
        processed_at = NOW()
      WHERE stripe_event_id = $1
    `,
    [stripeEventId]
  );
};

export const markStripeEventFailed = async (
  pool: Pool | null,
  stripeEventId: string
): Promise<void> => {
  if (!pool) {
    return;
  }

  await pool.query(
    `
      UPDATE stripe_events
      SET processing_status = 'failed'
      WHERE stripe_event_id = $1
    `,
    [stripeEventId]
  );
};

export const recordSponsorshipDetails = async (
  pool: Pool | null,
  input: SponsorshipDetailsRecordInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const result = await pool.query(
    `
      INSERT INTO fund_contributions (
        public_reference,
        contribution_type,
        amount_cents,
        currency,
        public_display_consent,
        display_amount_consent,
        non_charity_acknowledged,
        stripe_session_id,
        stripe_payment_intent_id,
        status,
        paid_at,
        sponsor_company_name,
        sponsor_contact_name,
        sponsor_contact_email,
        sponsor_website_url,
        sponsor_logo_url,
        sponsor_message,
        sponsor_details_submitted_at,
        sponsor_review_status
      )
      VALUES (
        $1, 'sponsorship_interest', $2, $3, $4, $5, $6, $7, $8, 'paid',
        $9::timestamptz, $10, $11, $12, $13, $14, $15, NOW(),
        'pending_review'
      )
      ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL
      DO UPDATE SET
        public_reference = COALESCE(
          fund_contributions.public_reference,
          EXCLUDED.public_reference
        ),
        sponsor_company_name = EXCLUDED.sponsor_company_name,
        sponsor_contact_name = EXCLUDED.sponsor_contact_name,
        sponsor_contact_email = EXCLUDED.sponsor_contact_email,
        sponsor_website_url = EXCLUDED.sponsor_website_url,
        sponsor_logo_url = EXCLUDED.sponsor_logo_url,
        sponsor_message = EXCLUDED.sponsor_message,
        sponsor_details_submitted_at = NOW(),
        status = 'paid',
        paid_at = COALESCE(fund_contributions.paid_at, EXCLUDED.paid_at),
        sponsor_review_status = 'pending_review',
        sponsor_reviewed_at = NULL,
        updated_at = NOW()
    `,
    [
      input.publicReference,
      input.amountCents,
      input.currency.toLowerCase(),
      input.publicDisplayConsent,
      input.displayAmountConsent,
      input.nonCharityAcknowledged,
      input.stripeSessionId,
      input.stripePaymentIntentId,
      input.paidAtIso,
      input.companyName,
      input.contactName,
      input.contactEmail,
      input.websiteUrl,
      input.logoUrl,
      input.message
    ]
  );

  return (result.rowCount ?? 0) > 0;
};

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
export const lockSponsorshipContribution = async (
  client: PoolClient,
  contributionId: string
): Promise<boolean> => {
  const result = await client.query<{ readonly id: string }>(
    "SELECT id FROM fund_contributions WHERE id = $1::uuid AND contribution_type = 'sponsorship_interest' FOR UPDATE",
    [contributionId]
  );
  return result.rows.length > 0;
};

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

export const getSponsorshipRefundTarget = async (
  pool: Pool | null,
  contributionId: string
): Promise<SponsorshipRefundTarget | null> => {
  if (!pool) {
    return null;
  }

  const query = await pool.query<{
    readonly id: string;
    readonly version: string;
    readonly public_reference: string | null;
    readonly payment_status: string;
    readonly sponsorship_refund_status: AdminSponsorshipRefundWorkflowStatus | null;
    readonly sponsorship_refund_id: string | null;
    readonly amount_cents: string;
    readonly currency: string;
    readonly stripe_payment_intent_id: string | null;
    readonly sponsor_name: string | null;
  }>(
    `
      SELECT
        id::text AS id,
        updated_at::text AS version,
        public_reference,
        status AS payment_status,
        COALESCE(sponsorship_refund_status, 'not_requested') AS sponsorship_refund_status,
        sponsorship_refund_id,
        amount_cents::text AS amount_cents,
        currency,
        stripe_payment_intent_id,
        COALESCE(
          NULLIF(btrim(sponsor_company_name), ''),
          NULLIF(btrim(public_name), ''),
          public_reference,
          'Commanditaire'
        ) AS sponsor_name
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

  const amountCents = parseDbInt(row.amount_cents);
  return {
    id: row.id,
    version: row.version,
    publicReference: row.public_reference,
    paymentStatus: row.payment_status,
    refundWorkflowStatus: normalizeSponsorshipRefundWorkflowStatus(
      row.sponsorship_refund_status,
      row.payment_status
    ),
    refundId: row.sponsorship_refund_id,
    amountCents,
    amount: centsToAmount(amountCents),
    currency: row.currency.toUpperCase(),
    stripePaymentIntentId: row.stripe_payment_intent_id,
    sponsorName: row.sponsor_name ?? 'Commanditaire'
  };
};

export const updateSponsorshipRefundWorkflowStatus = async (
  pool: Pool | PoolClient | null,
  input: SponsorshipRefundWorkflowUpdateInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const result = await pool.query(
    `
      UPDATE fund_contributions
      SET
        sponsorship_refund_status = $2,
        sponsorship_refund_requested_at = CASE
          WHEN $2 IN ('requested', 'processing') THEN NOW()
          WHEN $2 IN ('completed', 'failed')
          THEN COALESCE(sponsorship_refund_requested_at, NOW())
          ELSE sponsorship_refund_requested_at
        END,
        sponsorship_refund_processed_at = CASE
          WHEN $2 = 'processing' THEN NOW()
          WHEN $2 IN ('completed', 'failed')
          THEN COALESCE(sponsorship_refund_processed_at, NOW())
          ELSE sponsorship_refund_processed_at
        END,
        sponsorship_refund_completed_at = CASE
          WHEN $2 = 'completed' THEN NOW()
          WHEN $2 IN ('requested', 'processing', 'failed') THEN NULL
          ELSE sponsorship_refund_completed_at
        END,
        sponsorship_refund_id = COALESCE($3, sponsorship_refund_id),
        sponsorship_refund_amount_cents = COALESCE($6, sponsorship_refund_amount_cents),
        sponsorship_refund_reason = COALESCE($7, sponsorship_refund_reason),
        sponsorship_refund_note = COALESCE(NULLIF($4, ''), sponsorship_refund_note),
        sponsorship_refund_error = CASE
          WHEN $2 = 'failed' THEN $5
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
    `,
    [
      input.contributionId,
      input.refundStatus,
      input.refundId ?? null,
      input.refundNote ?? null,
      input.refundError ?? null,
      input.refundAmountCents ?? null,
      input.refundReason ?? null
    ]
  );

  return (result.rowCount ?? 0) > 0;
};

export const updateSponsorshipRefundWorkflowStatusByPaymentIntent = async (
  pool: Pool | null,
  input: SponsorshipRefundWorkflowUpdateByPaymentIntentInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const result = await pool.query(
    `
      UPDATE fund_contributions
      SET
        sponsorship_refund_status = $2,
        sponsorship_refund_requested_at = CASE
          WHEN $2 IN ('requested', 'processing') THEN NOW()
          WHEN $2 IN ('completed', 'failed')
          THEN COALESCE(sponsorship_refund_requested_at, NOW())
          ELSE sponsorship_refund_requested_at
        END,
        sponsorship_refund_processed_at = CASE
          WHEN $2 = 'processing' THEN NOW()
          WHEN $2 IN ('completed', 'failed')
          THEN COALESCE(sponsorship_refund_processed_at, NOW())
          ELSE sponsorship_refund_processed_at
        END,
        sponsorship_refund_completed_at = CASE
          WHEN $2 = 'completed' THEN NOW()
          WHEN $2 IN ('requested', 'processing', 'failed') THEN NULL
          ELSE sponsorship_refund_completed_at
        END,
        sponsorship_refund_id = COALESCE($3, sponsorship_refund_id),
        sponsorship_refund_amount_cents = COALESCE($6, sponsorship_refund_amount_cents),
        sponsorship_refund_reason = COALESCE($7, sponsorship_refund_reason),
        sponsorship_refund_note = COALESCE(NULLIF($4, ''), sponsorship_refund_note),
        sponsorship_refund_error = CASE
          WHEN $2 = 'failed' THEN $5
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE stripe_payment_intent_id = $1
        AND contribution_type = 'sponsorship_interest'
    `,
    [
      input.stripePaymentIntentId,
      input.refundStatus,
      input.refundId ?? null,
      input.refundNote ?? null,
      input.refundError ?? null,
      input.refundAmountCents ?? null,
      input.refundReason ?? null
    ]
  );

  return (result.rowCount ?? 0) > 0;
};

export const updateSponsorshipReview = async (
  pool: Pool | null,
  input: SponsorshipReviewInput
): Promise<SponsorshipReviewMutationResult> => {
  if (!pool) {
    return {
      status: 'not_found',
      updated: false,
      currentVersion: null,
      paymentStatus: null
    };
  }

  const target = await pool.query<{
    readonly status: string;
    readonly review_status: SponsorshipReviewStatus;
    readonly version: string;
    readonly has_approved_presentation_photo: boolean;
  }>(
    `
      SELECT
        status,
        COALESCE(sponsor_review_status, 'pending_review') AS review_status,
        updated_at::text AS version,
        ${SPONSOR_APPROVED_PRESENTATION_SQL} AS has_approved_presentation_photo
      FROM fund_contributions
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
    `,
    [input.contributionId]
  );

  const targetRow = target.rows[0];
  if (!targetRow) {
    return {
      status: 'not_found',
      updated: false,
      currentVersion: null,
      paymentStatus: null
    };
  }

  if (targetRow.version !== input.expectedVersion) {
    return {
      status: 'conflict',
      updated: false,
      currentVersion: targetRow.version,
      paymentStatus: targetRow.status
    };
  }

  if (
    input.reviewStatus === 'approved' &&
    targetRow.status !== 'paid' &&
    targetRow.review_status !== 'approved'
  ) {
    return {
      status: 'payment_not_eligible',
      updated: false,
      currentVersion: targetRow.version,
      paymentStatus: targetRow.status
    };
  }

  if (
    input.reviewStatus === 'approved' &&
    !targetRow.has_approved_presentation_photo
  ) {
    return {
      status: 'media_required',
      updated: false,
      currentVersion: targetRow.version,
      paymentStatus: targetRow.status
    };
  }

  const result = await pool.query<{ readonly version: string }>(
    `
      UPDATE fund_contributions
      SET
        sponsor_review_status = $2,
        sponsor_site_visibility_held = CASE WHEN $2 = 'approved' AND sponsor_review_status IS DISTINCT FROM 'approved' THEN TRUE ELSE sponsor_site_visibility_held END,
        sponsor_review_note = $3,
        sponsor_reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
        AND updated_at::text = $4
        AND (
          $2 <> 'approved'
          OR ${SPONSOR_APPROVED_PRESENTATION_SQL}
        )
      RETURNING updated_at::text AS version
    `,
    [
      input.contributionId,
      input.reviewStatus,
      input.reviewNote,
      input.expectedVersion
    ]
  );

  const updatedVersion = result.rows[0]?.version;
  return updatedVersion
    ? {
        status: 'updated',
        updated: true,
        currentVersion: updatedVersion,
        paymentStatus: targetRow.status
      }
    : {
        status: 'conflict',
        updated: false,
        currentVersion: targetRow.version,
        paymentStatus: targetRow.status
      };
};

export const updateSponsorshipPublication = async (
  pool: Pool | null,
  input: SponsorshipPublicationInput
): Promise<SponsorshipPublicationMutationResult> => {
  if (!pool) {
    return {
      status: 'not_found',
      updated: false,
      feedChannels: input.feedChannels,
      currentVersion: null,
      paymentStatus: null
    };
  }

  const target = await pool.query<{
    readonly amount_cents: string;
    readonly status: string;
    readonly version: string;
    readonly sponsor_public_slug: string | null;
    readonly sponsor_public_summary: string | null;
    readonly sponsor_feed_target: SponsorFeedTarget | null;
    readonly sponsor_feed_channels: unknown;
    readonly sponsor_feed_status: SponsorFeedStatus | null;
    readonly sponsor_feed_public_url: string | null;
  }>(
    `
      SELECT
        amount_cents::text AS amount_cents,
        status,
        updated_at::text AS version,
        sponsor_public_slug,
        sponsor_public_summary,
        sponsor_feed_target,
        sponsor_feed_channels,
        sponsor_feed_status,
        sponsor_feed_public_url
      FROM fund_contributions
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
    `,
    [input.contributionId]
  );

  const targetRow = target.rows[0];
  if (!targetRow) {
    return {
      status: 'not_found',
      updated: false,
      feedChannels: input.feedChannels,
      currentVersion: null,
      paymentStatus: null
    };
  }

  if (targetRow.version !== input.expectedVersion) {
    return {
      status: 'conflict',
      updated: false,
      feedChannels: input.feedChannels,
      currentVersion: targetRow.version,
      paymentStatus: targetRow.status
    };
  }

  const requestedFeedChannels = [...new Set(input.feedChannels)];
  const currentFeedChannels = parseSponsorFeedChannels(
    targetRow.sponsor_feed_channels
  );
  const feedChannels =
    targetRow.status === 'paid'
      ? mergePromisedSponsorFeedChannels(
          requestedFeedChannels,
          centsToAmount(parseDbInt(targetRow.amount_cents))
        )
      : requestedFeedChannels;
  const visibilityMetadataChanged =
    normalizedNullableText(input.publicSlug) !==
      normalizedNullableText(targetRow.sponsor_public_slug) ||
    normalizedNullableText(input.publicSummary) !==
      normalizedNullableText(targetRow.sponsor_public_summary) ||
    (input.feedTarget ?? null) !==
      normalizeSponsorFeedTarget(targetRow.sponsor_feed_target) ||
    !sponsorFeedChannelsEqual(feedChannels, currentFeedChannels) ||
    input.feedStatus !==
      normalizeSponsorFeedStatus(targetRow.sponsor_feed_status) ||
    normalizedNullableText(input.feedPublicUrl) !==
      normalizedNullableText(targetRow.sponsor_feed_public_url);

  if (targetRow.status !== 'paid' && visibilityMetadataChanged) {
    return {
      status: 'payment_not_eligible',
      updated: false,
      feedChannels,
      currentVersion: targetRow.version,
      paymentStatus: targetRow.status
    };
  }

  const result = await pool.query<{ readonly version: string }>(
    `
      UPDATE fund_contributions
      SET
        sponsor_public_slug = $2,
        sponsor_public_summary = $3,
        sponsor_feed_target = $4,
        sponsor_feed_channels = $5::jsonb,
        sponsor_feed_status = $6,
        sponsor_feed_public_url = $7,
        sponsor_feed_notes = $8,
        sponsor_visibility_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
        AND updated_at::text = $9
      RETURNING updated_at::text AS version
    `,
    [
      input.contributionId,
      input.publicSlug?.trim() || null,
      input.publicSummary?.trim() || null,
      input.feedTarget ?? null,
      JSON.stringify(feedChannels),
      input.feedStatus,
      input.feedPublicUrl?.trim() || null,
      input.feedNotes?.trim() || null,
      input.expectedVersion
    ]
  );

  const updatedVersion = result.rows[0]?.version;
  return {
    status: updatedVersion ? 'updated' : 'conflict',
    updated: Boolean(updatedVersion),
    feedChannels,
    currentVersion: updatedVersion ?? targetRow.version,
    paymentStatus: targetRow.status
  };
};

export const updateSponsorshipLogoUrl = async (
  pool: Pool | null,
  input: SponsorshipLogoInput
): Promise<SponsorshipLogoMutationResult> => {
  if (!pool) {
    return {
      status: 'not_found',
      updated: false,
      previousLogoUrl: null,
      currentVersion: null
    };
  }

  const result = await pool.query<{
    readonly updated: boolean;
    readonly previous_logo_url: string | null;
    readonly current_version: string | null;
  }>(
    `
      WITH target AS (
        SELECT
          sponsor_logo_url AS previous_logo_url,
          updated_at::text AS previous_version
        FROM fund_contributions
        WHERE id = $1::uuid
          AND contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
        FOR UPDATE
      ),
      updated AS (
        UPDATE fund_contributions
        SET
          sponsor_logo_url = $2,
          updated_at = NOW()
        WHERE id = $1::uuid
          AND contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
          AND updated_at::text = $3
        RETURNING id, updated_at::text AS current_version
      )
      SELECT
        EXISTS (SELECT 1 FROM updated) AS updated,
        (SELECT previous_logo_url FROM target) AS previous_logo_url,
        COALESCE(
          (SELECT current_version FROM updated),
          (SELECT previous_version FROM target)
        ) AS current_version
    `,
    [input.contributionId, input.logoUrl, input.expectedVersion]
  );

  const row = result.rows[0];
  const currentVersion = row?.current_version ?? null;
  const found = currentVersion !== null;
  return {
    status: row?.updated ? 'updated' : found ? 'conflict' : 'not_found',
    updated: row?.updated ?? false,
    previousLogoUrl: row?.previous_logo_url ?? null,
    currentVersion
  };
};

export const clearSponsorshipLogoUrl = async (
  pool: Pool | null,
  input: SponsorshipLogoDeleteInput
): Promise<SponsorshipLogoMutationResult> => {
  if (!pool) {
    return {
      status: 'not_found',
      updated: false,
      previousLogoUrl: null,
      currentVersion: null
    };
  }

  const result = await pool.query<{
    readonly updated: boolean;
    readonly previous_logo_url: string | null;
    readonly current_version: string | null;
  }>(
    `
      WITH target AS (
        SELECT
          sponsor_logo_url AS previous_logo_url,
          updated_at::text AS previous_version
        FROM fund_contributions
        WHERE id = $1::uuid
          AND contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
        FOR UPDATE
      ),
      updated AS (
        UPDATE fund_contributions
        SET
          sponsor_logo_url = NULL,
          updated_at = NOW()
        WHERE id = $1::uuid
          AND contribution_type = 'sponsorship_interest'
          AND status IN ('paid', 'refunded', 'disputed')
          AND updated_at::text = $2
        RETURNING id, updated_at::text AS current_version
      )
      SELECT
        EXISTS (SELECT 1 FROM updated) AS updated,
        (SELECT previous_logo_url FROM target) AS previous_logo_url,
        COALESCE(
          (SELECT current_version FROM updated),
          (SELECT previous_version FROM target)
        ) AS current_version
    `,
    [input.contributionId, input.expectedVersion]
  );

  const row = result.rows[0];
  const currentVersion = row?.current_version ?? null;
  const found = currentVersion !== null;
  return {
    status: row?.updated ? 'updated' : found ? 'conflict' : 'not_found',
    updated: row?.updated ?? false,
    previousLogoUrl: row?.previous_logo_url ?? null,
    currentVersion
  };
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

export interface SponsorshipFollowupLookup extends SponsorshipFollowupResponse {
  readonly contributionId: string;
  readonly stripeSessionId: string | null;
  readonly stripePaymentIntentId: string | null;
  readonly emailPrivate: string | null;
  readonly emailSentAt: string | null;
}

export const getSponsorshipFollowupByTokenHash = async (
  pool: Pool | null,
  tokenHash: string,
  tokenCreatedAfterIso: string
): Promise<SponsorshipFollowupLookup | null> => {
  if (!pool) {
    return null;
  }

  const query = await pool.query<SponsorshipFollowupRow>(
    `
      SELECT
        id::text AS id,
        public_reference,
        amount_cents::text AS amount_cents,
        currency,
        status AS payment_status,
        paid_at::text AS paid_at,
        sponsor_company_name,
        sponsor_contact_name,
        sponsor_contact_email,
        sponsor_website_url,
        sponsor_logo_url,
        sponsor_message,
        sponsor_details_submitted_at::text AS sponsor_details_submitted_at,
        COALESCE(sponsor_review_status, 'pending_review') AS sponsor_review_status,
        sponsor_reviewed_at::text AS sponsor_reviewed_at,
        stripe_session_id,
        stripe_payment_intent_id,
        email_private,
        sponsorship_followup_email_sent_at::text AS sponsorship_followup_email_sent_at
      FROM fund_contributions
      WHERE contribution_type = 'sponsorship_interest'
        AND ((sponsorship_followup_token_hash = $1
          AND sponsorship_followup_token_created_at >= $2::timestamptz)
          OR EXISTS (SELECT 1 FROM sponsorship_access_tokens access
            WHERE access.contribution_id = fund_contributions.id
              AND access.token_hash = $1 AND access.expires_at > NOW()))
      LIMIT 1
    `,
    [tokenHash, tokenCreatedAfterIso]
  );

  const row = query.rows[0];
  if (!row) {
    return null;
  }

  const amount = centsToAmount(parseDbInt(row.amount_cents));
  const sponsorshipBenefits = resolveSponsorshipBenefits(amount);

  return {
    found: true,
    publicReference: row.public_reference,
    contributionId: row.id,
    stripeSessionId: row.stripe_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    emailPrivate: row.email_private,
    emailSentAt: row.sponsorship_followup_email_sent_at,
    paymentStatus: row.payment_status,
    reviewStatus: row.sponsor_review_status,
    amount,
    currency: row.currency.toUpperCase(),
    paidAt: row.paid_at,
    sponsorshipTier: sponsorshipBenefits.tier,
    sponsorshipBenefits: sponsorshipBenefits.achievedBenefits,
    detailsSubmitted: Boolean(row.sponsor_details_submitted_at),
    companyName: row.sponsor_company_name,
    contactName: row.sponsor_contact_name,
    contactEmail: row.sponsor_contact_email,
    websiteUrl: row.sponsor_website_url,
    logoUrl: row.sponsor_logo_url,
    message: row.sponsor_message,
    reviewedAt: row.sponsor_reviewed_at
  };
};

export const recordSponsorshipDetailsForContribution = async (
  pool: Pool | PoolClient | null,
  input: SponsorshipFollowupRecordInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const result = await pool.query(
    `
      UPDATE fund_contributions
      SET
        sponsor_company_name = $2,
        sponsor_contact_name = $3,
        sponsor_contact_email = $4,
        sponsor_website_url = $5,
        sponsor_logo_url = $6,
        sponsor_message = $7,
        sponsor_details_submitted_at = clock_timestamp(),
        sponsor_review_status = 'pending_review',
        sponsor_reviewed_at = NULL,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
    `,
    [
      input.contributionId,
      input.companyName,
      input.contactName,
      input.contactEmail,
      input.websiteUrl,
      input.logoUrl,
      input.message
    ]
  );

  return (result.rowCount ?? 0) > 0;
};

export const markSponsorshipFollowupEmailResult = async (
  pool: Pool | null,
  input: SponsorshipFollowupEmailRecordInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const result = await pool.query(
    `
      UPDATE fund_contributions
      SET
        sponsorship_followup_email_sent_at = CASE
          WHEN $2::text IS NULL THEN sponsorship_followup_email_sent_at
          ELSE $2::timestamptz
        END,
        sponsorship_followup_email_error = $3,
        updated_at = NOW()
      WHERE stripe_session_id = $1
        AND contribution_type = 'sponsorship_interest'
    `,
    [input.stripeSessionId, input.sentAtIso ?? null, input.error]
  );

  return (result.rowCount ?? 0) > 0;
};
