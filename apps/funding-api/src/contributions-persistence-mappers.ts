import type {
  AdminContributionRecord,
  ContributionType,
  SponsorFeedStatus,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import {
  centsToAmount,
  parseDbInt,
  normalizeSponsorFeedStatus,
  normalizeSponsorshipReviewStatus
} from './contributions-persistence-helpers.js';

export interface AdminContributionRow {
  readonly id: string;
  readonly public_reference: string | null;
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

export interface ContributionReferenceRecoveryRecord {
  readonly publicReference: string;
  readonly contributionType: ContributionType;
  readonly amount: number;
  readonly currency: string;
  readonly paymentStatus: string;
  readonly paidAt: string | null;
  readonly createdAt: string;
  readonly displayName: string | null;
}

export interface ContributionReferenceRecoveryRow {
  readonly public_reference: string;
  readonly contribution_type: ContributionType;
  readonly amount_cents: string;
  readonly currency: string;
  readonly payment_status: string;
  readonly paid_at: string | null;
  readonly created_at: string;
  readonly display_name: string | null;
}

export interface PublicReferenceLookupRow {
  readonly public_reference: string;
  readonly contribution_type: ContributionType;
  readonly amount_cents: string;
  readonly currency: string;
  readonly payment_status: string;
  readonly display_amount_consent: boolean;
  readonly paid_at: string | null;
  readonly created_at: string;
  readonly review_status: SponsorshipReviewStatus | null;
  readonly details_submitted: boolean | null;
}

export const mapAdminContributionRow = (
  row: AdminContributionRow
): AdminContributionRecord => ({
  id: row.id,
  public_reference: row.public_reference,
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
