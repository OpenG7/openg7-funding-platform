import type {
  AdminContributionRecord,
  AdminContributionsResponse,
  AdminContributionsSummary,
  AdminDashboardResponse,
  AdminSponsorshipPublicationRequest,
  AdminSponsorshipRecord,
  PublicSponsorshipProfile,
  PublicSponsorshipsResponse,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget,
  SponsorshipFollowupResponse,
  SponsorshipReviewStatus,
  ContributionType
} from '@openg7/funding-core';
import type { Pool } from 'pg';

const allowedContributionTypes = new Set<ContributionType>([
  'personal_support',
  'sponsorship_interest'
]);
export const allowedSponsorshipReviewStatuses =
  new Set<SponsorshipReviewStatus>(['pending_review', 'approved', 'rejected']);
export const allowedSponsorFeedTargets = new Set<SponsorFeedTarget>([
  'openg7',
  'openg20'
]);
export const allowedSponsorFeedChannels = new Set<SponsorFeedChannel>([
  'facebook',
  'linkedin'
]);
export const allowedSponsorFeedStatuses = new Set<SponsorFeedStatus>([
  'not_planned',
  'planned',
  'drafted',
  'published'
]);

export interface CheckoutSessionRecordInput {
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly contributionType: ContributionType;
  readonly amountCents: number;
  readonly currency: string;
  readonly metadata: Record<string, string>;
  readonly publicDisplayConsent: boolean;
  readonly publicName: string | null;
  readonly displayAmountConsent: boolean;
  readonly nonCharityAcknowledged: boolean;
  readonly sponsorshipFollowupTokenHash: string | null;
}

export interface StripeEventRecordInput {
  readonly stripeEventId: string;
  readonly eventType: string;
  readonly payload: unknown;
}

export interface CheckoutSessionWebhookInput extends CheckoutSessionRecordInput {
  readonly status: 'pending' | 'paid' | 'expired';
  readonly paidAtIso: string | null;
  readonly emailPrivate: string | null;
}

export interface PaymentIntentStatusInput {
  readonly stripePaymentIntentId: string;
  readonly status: 'paid' | 'failed' | 'refunded' | 'disputed';
  readonly paidAtIso?: string | null;
}

export interface SponsorshipDetailsRecordInput {
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
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
}

export type SponsorshipPublicationInput = AdminSponsorshipPublicationRequest;

export interface SponsorshipLogoInput {
  readonly contributionId: string;
  readonly logoUrl: string;
}

export interface SponsorshipLogoMutationResult {
  readonly updated: boolean;
  readonly previousLogoUrl: string | null;
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
  readonly created_at: string;
  readonly updated_at: string;
}

interface AdminContributionRow {
  readonly id: string;
  readonly contribution_type: ContributionType;
  readonly amount_cents: string;
  readonly currency: string;
  readonly payment_status: string;
  readonly paid_at: string | null;
  readonly public_name: string | null;
  readonly email_private: string | null;
  readonly public_display_consent: boolean;
  readonly display_amount_consent: boolean;
  readonly non_charity_acknowledged: boolean;
  readonly sponsor_company_name: string | null;
  readonly sponsor_contact_name: string | null;
  readonly sponsor_contact_email: string | null;
  readonly sponsor_review_status: SponsorshipReviewStatus | null;
  readonly sponsor_feed_status: SponsorFeedStatus | null;
  readonly stripe_session_id: string | null;
  readonly stripe_payment_intent_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

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

interface PublicSponsorshipRow {
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
}

interface SponsorshipFollowupRow {
  readonly id: string;
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

const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));

const parseDbInt = (value: string): number => Number.parseInt(value, 10);

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

const normalizeSponsorFeedStatus = (
  value: SponsorFeedStatus | null
): SponsorFeedStatus =>
  value && allowedSponsorFeedStatuses.has(value) ? value : 'not_planned';

const normalizeSponsorFeedTarget = (
  value: SponsorFeedTarget | null
): SponsorFeedTarget | null =>
  value && allowedSponsorFeedTargets.has(value) ? value : null;

const normalizeSponsorshipReviewStatus = (
  value: SponsorshipReviewStatus | null
): SponsorshipReviewStatus | null =>
  value && allowedSponsorshipReviewStatuses.has(value) ? value : null;

const mapAdminContributionRow = (
  row: AdminContributionRow
): AdminContributionRecord => ({
  id: row.id,
  contribution_type: row.contribution_type,
  amount: centsToAmount(parseDbInt(row.amount_cents)),
  currency: row.currency.toUpperCase(),
  payment_status: row.payment_status,
  paid_at: row.paid_at,
  public_name: row.public_name,
  email_private: row.email_private,
  public_display_consent: row.public_display_consent,
  display_amount_consent: row.display_amount_consent,
  non_charity_acknowledged: row.non_charity_acknowledged,
  sponsor_company_name: row.sponsor_company_name,
  sponsor_contact_name: row.sponsor_contact_name,
  sponsor_contact_email: row.sponsor_contact_email,
  sponsor_review_status:
    row.contribution_type === 'sponsorship_interest'
      ? normalizeSponsorshipReviewStatus(row.sponsor_review_status)
      : null,
  sponsor_feed_status:
    row.contribution_type === 'sponsorship_interest'
      ? normalizeSponsorFeedStatus(row.sponsor_feed_status)
      : null,
  stripe_session_id: row.stripe_session_id,
  stripe_payment_intent_id: row.stripe_payment_intent_id,
  created_at: row.created_at,
  updated_at: row.updated_at
});

export const normalizeContributionType = (
  value: string | undefined
): ContributionType =>
  value && allowedContributionTypes.has(value as ContributionType)
    ? (value as ContributionType)
    : 'personal_support';

export const parseMetadataBoolean = (value: string | undefined): boolean =>
  value === 'true';

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

export const insertCheckoutSessionRecord = async (
  pool: Pool | null,
  input: CheckoutSessionRecordInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sessionResult = await client.query(
      `
        INSERT INTO stripe_checkout_sessions (
          stripe_session_id,
          stripe_payment_intent_id,
          contribution_type,
          amount_cents,
          currency,
          metadata,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')
        ON CONFLICT (stripe_session_id) DO NOTHING
      `,
      [
        input.stripeSessionId,
        input.stripePaymentIntentId,
        input.contributionType,
        input.amountCents,
        input.currency.toLowerCase(),
        JSON.stringify(input.metadata)
      ]
    );

    await client.query(
      `
        INSERT INTO fund_contributions (
          contribution_type,
          amount_cents,
          currency,
          public_display_consent,
          public_name,
          display_amount_consent,
          non_charity_acknowledged,
          stripe_session_id,
          stripe_payment_intent_id,
          status,
          sponsorship_followup_token_hash,
          sponsorship_followup_token_created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10,
          CASE WHEN $10::text IS NULL THEN NULL ELSE NOW() END
        )
        ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL
        DO NOTHING
      `,
      [
        input.contributionType,
        input.amountCents,
        input.currency.toLowerCase(),
        input.publicDisplayConsent,
        input.publicName,
        input.displayAmountConsent,
        input.nonCharityAcknowledged,
        input.stripeSessionId,
        input.stripePaymentIntentId,
        input.sponsorshipFollowupTokenHash
      ]
    );

    await client.query('COMMIT');
    return sessionResult.rowCount === 1;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const upsertCheckoutSessionFromWebhook = async (
  pool: Pool | null,
  input: CheckoutSessionWebhookInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `
        INSERT INTO stripe_checkout_sessions (
          stripe_session_id,
          stripe_payment_intent_id,
          contribution_type,
          amount_cents,
          currency,
          metadata,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        ON CONFLICT (stripe_session_id) DO UPDATE
        SET
          stripe_payment_intent_id = COALESCE(
            EXCLUDED.stripe_payment_intent_id,
            stripe_checkout_sessions.stripe_payment_intent_id
          ),
          metadata = stripe_checkout_sessions.metadata || EXCLUDED.metadata,
          status = EXCLUDED.status,
          updated_at = NOW()
      `,
      [
        input.stripeSessionId,
        input.stripePaymentIntentId,
        input.contributionType,
        input.amountCents,
        input.currency.toLowerCase(),
        JSON.stringify(input.metadata),
        input.status
      ]
    );

    const result = await client.query(
      `
        INSERT INTO fund_contributions (
          contribution_type,
          amount_cents,
          currency,
          email_private,
          public_display_consent,
          public_name,
          display_amount_consent,
          non_charity_acknowledged,
          stripe_session_id,
          stripe_payment_intent_id,
          status,
          paid_at,
          sponsorship_followup_token_hash,
          sponsorship_followup_token_created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12::timestamptz, $13,
          CASE WHEN $13::text IS NULL THEN NULL ELSE NOW() END
        )
        ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL
        DO UPDATE
        SET
          stripe_payment_intent_id = COALESCE(
            EXCLUDED.stripe_payment_intent_id,
            fund_contributions.stripe_payment_intent_id
          ),
          email_private = COALESCE(
            fund_contributions.email_private,
            EXCLUDED.email_private
          ),
          public_display_consent = EXCLUDED.public_display_consent,
          public_name = COALESCE(EXCLUDED.public_name, fund_contributions.public_name),
          display_amount_consent = EXCLUDED.display_amount_consent,
          non_charity_acknowledged = EXCLUDED.non_charity_acknowledged,
          status = CASE
            WHEN fund_contributions.status = 'paid'
              AND EXCLUDED.status IN ('pending', 'expired')
            THEN fund_contributions.status
            ELSE EXCLUDED.status
          END,
          paid_at = COALESCE(fund_contributions.paid_at, EXCLUDED.paid_at),
          sponsorship_followup_token_hash = COALESCE(
            fund_contributions.sponsorship_followup_token_hash,
            EXCLUDED.sponsorship_followup_token_hash
          ),
          sponsorship_followup_token_created_at = COALESCE(
            fund_contributions.sponsorship_followup_token_created_at,
            EXCLUDED.sponsorship_followup_token_created_at
          ),
          updated_at = NOW()
      `,
      [
        input.contributionType,
        input.amountCents,
        input.currency.toLowerCase(),
        input.emailPrivate,
        input.publicDisplayConsent,
        input.publicName,
        input.displayAmountConsent,
        input.nonCharityAcknowledged,
        input.stripeSessionId,
        input.stripePaymentIntentId,
        input.status,
        input.paidAtIso,
        input.sponsorshipFollowupTokenHash
      ]
    );

    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const updateContributionStatusByPaymentIntent = async (
  pool: Pool | null,
  input: PaymentIntentStatusInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `
        UPDATE stripe_checkout_sessions
        SET
          status = $2,
          updated_at = NOW()
        WHERE stripe_payment_intent_id = $1
      `,
      [input.stripePaymentIntentId, input.status]
    );

    const result = await client.query(
      `
        UPDATE fund_contributions
        SET
          status = $2,
          paid_at = CASE
            WHEN $2 = 'paid' THEN COALESCE(paid_at, $3::timestamptz)
            ELSE paid_at
          END,
          updated_at = NOW()
        WHERE stripe_payment_intent_id = $1
      `,
      [input.stripePaymentIntentId, input.status, input.paidAtIso ?? null]
    );

    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
        'sponsorship_interest', $1, $2, $3, $4, $5, $6, $7, 'paid',
        $8::timestamptz, $9, $10, $11, $12, $13, $14, NOW(),
        'pending_review'
      )
      ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL
      DO UPDATE SET
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

const getAdminContributionsSummary = async (
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

  return {
    summary: {
      total_count: parseDbInt(row.total_count),
      paid_count: parseDbInt(row.paid_count),
      pending_count: parseDbInt(row.pending_count),
      sponsorship_count: parseDbInt(row.sponsorship_count),
      public_display_count: parseDbInt(row.public_display_count),
      total_received: centsToAmount(parseDbInt(row.total_received)),
      total_refunded: centsToAmount(parseDbInt(row.total_refunded)),
      total_disputed: centsToAmount(parseDbInt(row.total_disputed)),
      currency: row.currency.toUpperCase()
    },
    lastUpdatedAt: row.last_updated_at
  };
};

const listRecentAdminContributions = async (
  pool: Pool | null,
  limit: number
): Promise<readonly AdminContributionRecord[]> => {
  if (!pool) {
    return [];
  }

  const query = await pool.query<AdminContributionRow>(
    `
      SELECT
        id::text AS id,
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
      ORDER BY COALESCE(paid_at, updated_at, created_at) DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(limit, 500))]
  );

  return query.rows.map(mapAdminContributionRow);
};

export const listAdminContributions = async (
  pool: Pool | null
): Promise<AdminContributionsResponse> => {
  const [{ summary, lastUpdatedAt }, contributions] = await Promise.all([
    getAdminContributionsSummary(pool),
    listRecentAdminContributions(pool, 250)
  ]);

  return {
    data_source: 'database',
    summary,
    contributions,
    last_updated_at: lastUpdatedAt
  };
};

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
    sponsorship_review: sponsorshipReview,
    feed_publication: feedPublication,
    stripe_events: stripeEvents,
    recent_contributions: recentContributions,
    last_updated_at: lastUpdatedAt
  };
};

export const listAdminSponsorships = async (
  pool: Pool | null
): Promise<readonly AdminSponsorshipRecord[]> => {
  if (!pool) {
    return [];
  }

  const query = await pool.query<AdminSponsorshipRow>(`
    SELECT
      id::text AS id,
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
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM fund_contributions
    WHERE contribution_type = 'sponsorship_interest'
      AND status IN ('paid', 'refunded', 'disputed')
    ORDER BY
      CASE COALESCE(sponsor_review_status, 'pending_review')
        WHEN 'pending_review' THEN 0
        WHEN 'approved' THEN 1
        ELSE 2
      END,
      COALESCE(sponsor_details_submitted_at, paid_at, updated_at, created_at) DESC
    LIMIT 100
  `);

  return query.rows.map((row) => ({
    id: row.id,
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
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
};

export const updateSponsorshipReview = async (
  pool: Pool | null,
  input: SponsorshipReviewInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const result = await pool.query(
    `
      UPDATE fund_contributions
      SET
        sponsor_review_status = $2,
        sponsor_review_note = $3,
        sponsor_reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
    `,
    [input.contributionId, input.reviewStatus, input.reviewNote]
  );

  return (result.rowCount ?? 0) > 0;
};

export const updateSponsorshipPublication = async (
  pool: Pool | null,
  input: SponsorshipPublicationInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const result = await pool.query(
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
    `,
    [
      input.contributionId,
      input.publicSlug?.trim() || null,
      input.publicSummary?.trim() || null,
      input.feedTarget ?? null,
      JSON.stringify(input.feedChannels),
      input.feedStatus,
      input.feedPublicUrl?.trim() || null,
      input.feedNotes?.trim() || null
    ]
  );

  return (result.rowCount ?? 0) > 0;
};

export const updateSponsorshipLogoUrl = async (
  pool: Pool | null,
  input: SponsorshipLogoInput
): Promise<SponsorshipLogoMutationResult> => {
  if (!pool) {
    return { updated: false, previousLogoUrl: null };
  }

  const result = await pool.query<{
    readonly updated: boolean;
    readonly previous_logo_url: string | null;
  }>(
    `
      WITH target AS (
        SELECT sponsor_logo_url AS previous_logo_url
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
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM updated) AS updated,
        (SELECT previous_logo_url FROM target) AS previous_logo_url
    `,
    [input.contributionId, input.logoUrl]
  );

  const row = result.rows[0];
  return {
    updated: row?.updated ?? false,
    previousLogoUrl: row?.previous_logo_url ?? null
  };
};

export const clearSponsorshipLogoUrl = async (
  pool: Pool | null,
  contributionId: string
): Promise<SponsorshipLogoMutationResult> => {
  if (!pool) {
    return { updated: false, previousLogoUrl: null };
  }

  const result = await pool.query<{
    readonly updated: boolean;
    readonly previous_logo_url: string | null;
  }>(
    `
      WITH target AS (
        SELECT sponsor_logo_url AS previous_logo_url
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
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM updated) AS updated,
        (SELECT previous_logo_url FROM target) AS previous_logo_url
    `,
    [contributionId]
  );

  const row = result.rows[0];
  return {
    updated: row?.updated ?? false,
    previousLogoUrl: row?.previous_logo_url ?? null
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
      ) = 7 AS has_sponsor_publication_columns
  `);

  return (
    query.rows[0] ?? {
      has_fund_contributions: false,
      has_sponsor_review_status: false,
      has_sponsor_publication_columns: false
    }
  );
};

export const listPublicSponsorships = async (
  pool: Pool | null
): Promise<PublicSponsorshipsResponse> => {
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
    !presence.has_sponsor_publication_columns
  ) {
    return {
      data_source: 'empty',
      sponsorships: [],
      last_updated_at: now
    };
  }

  const query = await pool.query<PublicSponsorshipRow>(`
    SELECT
      sponsor_public_slug AS public_slug,
      sponsor_company_name AS company_name,
      sponsor_website_url AS website_url,
      sponsor_logo_url AS logo_url,
      sponsor_message AS message,
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
      updated_at::text AS updated_at
    FROM fund_contributions
    WHERE contribution_type = 'sponsorship_interest'
      AND status IN ('paid', 'refunded', 'disputed')
      AND public_display_consent IS TRUE
      AND sponsor_review_status = 'approved'
      AND sponsor_company_name IS NOT NULL
      AND btrim(sponsor_company_name) <> ''
    ORDER BY COALESCE(
      sponsor_visibility_updated_at,
      sponsor_reviewed_at,
      paid_at,
      updated_at,
      created_at
    ) DESC
    LIMIT 50
  `);

  const sponsorships: readonly PublicSponsorshipProfile[] = query.rows.map(
    (row) => ({
      public_slug: row.public_slug,
      company_name: row.company_name,
      website_url: row.website_url,
      logo_url: row.logo_url,
      message: row.message,
      public_summary: row.public_summary,
      amount: row.amount ? centsToAmount(parseDbInt(row.amount)) : null,
      currency: row.currency.toUpperCase(),
      paid_at: row.paid_at,
      feed_target: normalizeSponsorFeedTarget(row.feed_target),
      feed_channels: parseSponsorFeedChannels(row.feed_channels),
      feed_status: normalizeSponsorFeedStatus(row.feed_status),
      feed_public_url: row.feed_public_url,
      visibility_updated_at: row.visibility_updated_at
    })
  );

  const lastUpdatedAt =
    query.rows.reduce<string | null>((latest, row) => {
      const candidate = row.visibility_updated_at ?? row.updated_at;
      if (!latest) {
        return candidate;
      }

      return new Date(candidate).getTime() > new Date(latest).getTime()
        ? candidate
        : latest;
    }, null) ?? now;

  return {
    data_source: 'database',
    sponsorships,
    last_updated_at: lastUpdatedAt
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
        AND sponsorship_followup_token_hash = $1
        AND sponsorship_followup_token_created_at >= $2::timestamptz
      LIMIT 1
    `,
    [tokenHash, tokenCreatedAfterIso]
  );

  const row = query.rows[0];
  if (!row) {
    return null;
  }

  return {
    found: true,
    contributionId: row.id,
    stripeSessionId: row.stripe_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    emailPrivate: row.email_private,
    emailSentAt: row.sponsorship_followup_email_sent_at,
    paymentStatus: row.payment_status,
    reviewStatus: row.sponsor_review_status,
    amount: centsToAmount(parseDbInt(row.amount_cents)),
    currency: row.currency.toUpperCase(),
    paidAt: row.paid_at,
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
  pool: Pool | null,
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
        sponsor_details_submitted_at = NOW(),
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
