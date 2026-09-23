import { DEFAULT_SPONSORSHIP_PRICING_CONFIG } from './sponsorship-pricing.js';

export type ContributionPreparationState =
  | 'waiting_identity'
  | 'waiting_consent'
  | 'worker_stopped'
  | 'prepared'
  | 'ineligible';
export type ContributionReason =
  | 'payment_confirmed'
  | 'payment_inactive'
  | 'company_missing'
  | 'consent_missing'
  | 'website_eligible'
  | 'facebook_eligible'
  | 'linkedin_eligible'
  | 'facebook_below_threshold'
  | 'linkedin_below_threshold'
  | 'worker_stopped'
  | 'review_required'
  | 'media_required'
  | 'unsupported_contribution';
export interface ContributionPreparationFacts {
  amountMinor: number;
  currency: string;
  paymentStatus: string;
  contributionType: string;
  publicConsent: boolean;
  companyName: string | null;
  summary: string | null;
  reviewStatus: string | null;
  hidden: boolean;
  refundPending: boolean;
  mediaApproved: boolean;
  workerEnabled: boolean;
}
export interface ContributionPreparation {
  state: ContributionPreparationState;
  reasons: ContributionReason[];
  cartouche: { destination: 'website'; title: string; body: string } | null;
}
/** Private preparation only. This grants neither review nor public visibility. */
export function prepareContributionWebsite(
  f: ContributionPreparationFacts
): ContributionPreparation {
  const reasons: ContributionReason[] = ['payment_confirmed'];
  const result = (
    state: ContributionPreparationState
  ): ContributionPreparation => ({ state, reasons, cartouche: null });
  if (
    f.paymentStatus !== 'paid' ||
    f.refundPending ||
    f.hidden ||
    f.reviewStatus === 'rejected'
  ) {
    reasons.push('payment_inactive');
    return result('ineligible');
  }
  const benefits = DEFAULT_SPONSORSHIP_PRICING_CONFIG.benefits;
  if (
    f.contributionType !== 'sponsorship_interest' ||
    f.currency.toUpperCase() !== 'CAD' ||
    f.amountMinor < benefits.websiteMention.minimumAmount * 100
  ) {
    reasons.push('unsupported_contribution');
    return result('ineligible');
  }
  reasons.push(
    'website_eligible',
    f.amountMinor >= benefits.facebookBatch.minimumAmount * 100
      ? 'facebook_eligible'
      : 'facebook_below_threshold',
    f.amountMinor >= benefits.linkedinBatch.minimumAmount * 100
      ? 'linkedin_eligible'
      : 'linkedin_below_threshold'
  );
  if (!f.publicConsent) {
    reasons.push('consent_missing');
    return result('waiting_consent');
  }
  if (!f.companyName?.trim()) {
    reasons.push('company_missing');
    return result('waiting_identity');
  }
  if (!f.workerEnabled) {
    reasons.push('worker_stopped');
    return result('worker_stopped');
  }
  if (f.reviewStatus !== 'approved') reasons.push('review_required');
  if (!f.mediaApproved) reasons.push('media_required');
  return {
    state: 'prepared',
    reasons,
    cartouche: {
      destination: 'website',
      title: f.companyName.trim(),
      body:
        f.summary?.trim() || 'Merci de soutenir le Fonds des Bâtisseurs OpenG7.'
    }
  };
}
export interface ContributionActivityItem {
  id: string;
  contributionId: string;
  reference: string;
  companyName: string | null;
  amountMinor: number;
  currency: string;
  confirmedAt: string;
  revision: number;
  preparation: ContributionPreparation | null;
  email: 'not_configured' | 'queued' | 'sending' | 'sent' | 'failed';
  sms: 'disabled' | 'queued' | 'sending' | 'captured' | 'failed' | 'uncertain';
  simulatedSms: boolean;
  adminUrl: string;
  history: {
    revision: number;
    state: string;
    reasons: ContributionReason[];
    at: string;
  }[];
}
export interface ContributionActivityResponse {
  items: ContributionActivityItem[];
  hasMore: boolean;
}
