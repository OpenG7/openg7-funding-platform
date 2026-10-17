import type {
  AdminPreparationReceipt,
  SponsorshipOfferSnapshot
} from '@openg7/funding-core';

/** Synthetic immutable terms and private preparation; no real provider or payment. */
export const runId = '10000000-0000-4000-8000-000000001101';
export const observedAt = '2026-10-17T12:00:00.000Z';
export const approvedAt = '2026-10-17T12:05:00.000Z';
export const actor = 'synthetic-preparation-owner';
export const contributionId = (position: number) =>
  `10000000-0000-4000-8000-${String(1101 + position).padStart(12, '0')}`;

export function receipt(position: number): AdminPreparationReceipt {
  const id = contributionId(position);
  const website = position === 1;
  const amountMinor = [2500, 5000, 12500, 7500, 10000, 15000][position - 1]!;
  const acceptedOffer: SponsorshipOfferSnapshot = {
    version: 'synthetic-historical-offer-v1',
    amountMinor,
    currency: 'CAD',
    benefits: [
      website
        ? {
            id: 'website_mention',
            channel: 'website',
            target: 'openg7',
            quantity: 1,
            requiredElements: ['company_name', 'approved_presentation'],
            deadlineDays: null,
            durationDays: null
          }
        : {
            id: 'facebook_batch',
            channel: 'facebook',
            target: 'openg7',
            quantity: 2,
            format: 'collective_text',
            requiredElements: ['company_name', 'approved_presentation'],
            deadlineDays: 14,
            durationDays: null
          }
    ]
  };
  const missingConsent = position === 2;
  const examined = position <= 3;
  const incomplete = missingConsent || !examined;
  return {
    runId,
    position,
    totalCount: 6,
    processedCount: 3,
    contributionId: id,
    reference: `DEMO-PREP-${String(position).padStart(3, '0')}`,
    version: String(position).repeat(64),
    status: incomplete ? 'incomplete' : 'ready',
    payment: {
      amountMinor,
      currency: 'CAD',
      status: 'paid',
      confirmedAt: observedAt
    },
    acceptedOffer,
    balance: {
      contributionId: id,
      reference: `DEMO-PREP-${String(position).padStart(3, '0')}`,
      contributionType: 'sponsorship_interest',
      amountMinor,
      currency: 'CAD',
      paymentStatus: 'paid',
      version: 'synthetic-current-balance',
      status: 'action_required',
      expected: website ? 1 : 2,
      fulfilled: 0,
      waived: 0,
      outstanding: website ? 1 : 2,
      unknown: 0,
      reasons: ['publication_pending'],
      promisedBenefits: acceptedOffer.benefits,
      obligations: Array.from({ length: website ? 1 : 2 }, (_, index) => ({
        id: `synthetic-obligation-${position}-${index + 1}`,
        benefitId: website ? 'website_mention' : 'facebook_batch',
        channel: website ? 'website' : 'facebook',
        target: 'openg7',
        ordinal: index + 1,
        state: 'pending',
        version: 1,
        ...(website ? {} : { format: 'collective_text' as const })
      })),
      next: {
        reason: 'publication_pending',
        adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${id}`,
        target: 'sponsorship-dossier'
      }
    },
    checks: [
      {
        code: 'dossier_examined',
        state: examined ? 'complete' : 'missing'
      },
      { code: 'payment_confirmed', state: 'complete' },
      { code: 'accepted_offer', state: 'complete' },
      {
        code: 'content_prepared',
        state: incomplete ? 'missing' : 'complete'
      }
    ],
    authorizations: [
      {
        code: 'public_consent',
        state: missingConsent ? 'missing' : 'complete'
      },
      { code: 'sponsor_review', state: 'complete' },
      { code: 'moderation_review', state: 'complete' }
    ],
    drafts: incomplete
      ? []
      : [
          {
            id: `synthetic-private-draft-${position}`,
            kind: website ? 'website' : 'publication',
            version: website ? '1' : 'synthetic-draft-v1',
            title: `Texte exact synthétique ${position}`,
            body: `Présentation privée du dossier synthétique ${position}.`,
            disclosureText: website ? '' : 'Mention de commandite synthétique.',
            channel: website ? 'website' : 'facebook',
            target: 'openg7',
            status: website ? 'private' : 'draft',
            adminUrl: website
              ? `/admin/fundraiser/sponsors?sponsorshipId=${id}&tab=publication`
              : `/admin/fundraiser/publications/automation?sponsorshipId=${id}`
          }
        ],
    blockers: incomplete
      ? [
          {
            code: missingConsent
              ? 'public_consent_missing'
              : 'dossier_not_examined',
            adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${id}`
          }
        ]
      : [],
    canApprove: !incomplete,
    approval: null,
    approvalHistory: []
  };
}
