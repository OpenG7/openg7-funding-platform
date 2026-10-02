import type { SponsorshipAttentionRecord } from './fund-contributions.repository.js';

// Read-only eligibility shared by attention, reminders and dossier preparation.
// These checks grant neither review approval nor publication authorization.
export const isActionableSponsorship = (
  record: SponsorshipAttentionRecord
): boolean =>
  record.paymentStatus === 'paid' && record.refundStatus === 'not_requested';

export const missingFicheFields = (
  record: SponsorshipAttentionRecord
): readonly string[] => {
  const missing: string[] = [];
  if (record.detailsSubmittedAt === null) {
    missing.push('formulaire_non_soumis');
  }
  if (!record.hasCompanyName) {
    missing.push('nom_entreprise');
  }
  if (!record.hasContactEmail) {
    missing.push('courriel_contact');
  }
  if (!record.hasSupportingImage) {
    missing.push('photo_presentation');
  }
  return missing;
};

export const hasCompleteFiche = (record: SponsorshipAttentionRecord): boolean =>
  missingFicheFields(record).length === 0;

export const needsSponsorshipInformation = (
  record: SponsorshipAttentionRecord
): boolean =>
  isActionableSponsorship(record) &&
  record.reviewStatus !== 'rejected' &&
  !hasCompleteFiche(record);

export const isSponsorshipAwaitingReview = (
  record: SponsorshipAttentionRecord
): boolean =>
  isActionableSponsorship(record) &&
  hasCompleteFiche(record) &&
  record.reviewStatus === 'pending_review';
