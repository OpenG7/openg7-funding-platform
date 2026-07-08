import type {
  AdminSponsorshipRecord,
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
  new Set<SponsorshipReviewStatus>([
    'pending_review',
    'approved',
    'rejected'
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

export interface CheckoutSessionWebhookInput
  extends CheckoutSessionRecordInput {
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
  readonly created_at: string;
  readonly updated_at: string;
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
      [
        input.stripePaymentIntentId,
        input.status,
        input.paidAtIso ?? null
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
        sponsor_review_status = COALESCE(
          fund_contributions.sponsor_review_status,
          'pending_review'
        ),
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

export interface SponsorshipFollowupLookup extends SponsorshipFollowupResponse {
  readonly contributionId: string;
  readonly stripeSessionId: string | null;
  readonly stripePaymentIntentId: string | null;
  readonly emailPrivate: string | null;
  readonly emailSentAt: string | null;
}

export const getSponsorshipFollowupByTokenHash = async (
  pool: Pool | null,
  tokenHash: string
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
      LIMIT 1
    `,
    [tokenHash]
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
        sponsor_review_status = CASE
          WHEN sponsor_review_status = 'approved' THEN sponsor_review_status
          ELSE 'pending_review'
        END,
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
