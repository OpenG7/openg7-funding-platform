import type {
  SponsorshipFollowupResponse,
  SponsorshipReviewStatus
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { resolveSponsorshipBenefits } from '../../../packages/funding-core/src/index.js';

import {
  centsToAmount,
  parseDbInt
} from './contributions-persistence-helpers.js';
export interface SponsorshipFollowupLookup extends SponsorshipFollowupResponse {
  readonly contributionId: string;
  readonly stripeSessionId: string | null;
  readonly stripePaymentIntentId: string | null;
  readonly emailPrivate: string | null;
  readonly emailSentAt: string | null;
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
