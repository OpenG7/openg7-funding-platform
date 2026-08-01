// Deterministic admin attention service for the read-only AI assistant.
//
// This module is intentionally independent of any AI model: it composes the
// existing application repositories and turns their data into a prioritised,
// GLOBAL work queue of `AdminAttentionItem`s plus an `AdminAssistantSummary`.
// The AI layer (tools, provider, orchestrator) only ever reads what this
// service produces — it never decides a status, an amount or a permission.
//
// Privacy: items only carry minimal, non-sensitive facts. Company names,
// contact emails, follow-up tokens and provider secrets never appear here.

import type {
  AdminAttentionItem,
  AdminAttentionSeverity,
  AdminAssistantFinancialSummary,
  AdminAssistantSummary,
  AdminEmailQueueMessageRecord,
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  AdminPublicationSlotRecord,
  SponsorFeedChannel
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import {
  getAdminDashboard,
  listSponsorshipsForAttention,
  type SponsorshipAttentionRecord
} from '../fund-contributions.repository.js';
import {
  listAdminPublicationBatches,
  listAdminPublicationDrafts,
  listAdminPublicationSlots
} from '../fund-admin.repository.js';
import { listAdminEmailQueue } from '../email-notification.service.js';

const ADMIN_URLS = {
  sponsors: '/admin/fundraiser/sponsors',
  publications: '/admin/fundraiser/publications',
  emailQueue: '/admin/fundraiser/email-queue',
  transparency: '/admin/fundraiser/transparency'
} as const;

const SEVERITY_RANK: Record<AdminAttentionSeverity, number> = {
  urgent: 0,
  today: 1,
  this_week: 2,
  informational: 3
};

// Sponsorship publication-benefit thresholds (CAD). Kept in sync by hand with
// packages/funding-core (resolveSponsorshipBenefits) and
// apps/funding-api/src/fund-contributions.repository.ts, which the codebase
// already synchronises manually because funding-core has no runtime build.
const FACEBOOK_BATCH_MINIMUM = 250;
const LINKEDIN_BATCH_MINIMUM = 500;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default cap on the number of items materialised in a response. Counts are
 * always computed over the full detected set BEFORE this cap is applied. */
export const DEFAULT_MAX_ATTENTION_ITEMS = 100;

export interface FinancialTotalsInput {
  readonly grossPaid: number;
  readonly refunded: number;
  readonly disputed: number;
  readonly currency: string;
}

/** Everything the pure detectors need, already loaded from the repositories. */
export interface AttentionDataset {
  readonly now: Date;
  readonly sponsorships: readonly SponsorshipAttentionRecord[];
  readonly sponsorshipsTruncated: boolean;
  readonly drafts: readonly AdminPublicationDraftRecord[];
  readonly batches: readonly AdminPublicationBatchRecord[];
  readonly slots: readonly AdminPublicationSlotRecord[];
  readonly emailMessages: readonly AdminEmailQueueMessageRecord[];
  readonly financialTotals: FinancialTotalsInput;
}

const daysBetween = (later: Date, earlierIso: string | null): number | null => {
  if (!earlierIso) {
    return null;
  }
  const earlier = Date.parse(earlierIso);
  if (Number.isNaN(earlier)) {
    return null;
  }
  return Math.floor((later.getTime() - earlier) / MS_PER_DAY);
};

const severityForAge = (
  ageDays: number | null,
  urgentAfter: number,
  todayAfter: number
): AdminAttentionSeverity => {
  if (ageDays === null) {
    return 'this_week';
  }
  if (ageDays >= urgentAfter) {
    return 'urgent';
  }
  if (ageDays >= todayAfter) {
    return 'today';
  }
  return 'this_week';
};

export const promisedSocialChannels = (
  amount: number
): readonly SponsorFeedChannel[] => {
  const channels: SponsorFeedChannel[] = [];
  if (amount >= FACEBOOK_BATCH_MINIMUM) {
    channels.push('facebook');
  }
  if (amount >= LINKEDIN_BATCH_MINIMUM) {
    channels.push('linkedin');
  }
  return channels;
};

export const sponsorshipRef = (record: SponsorshipAttentionRecord): string =>
  record.publicReference ?? `#${record.contributionId.slice(0, 8)}`;

// A sponsorship is "actionable" (not refunded/cancelled/in-refund) when its
// payment is confirmed and no refund workflow is under way.
export const isActionableSponsorship = (
  record: SponsorshipAttentionRecord
): boolean =>
  record.paymentStatus === 'paid' && record.refundStatus === 'not_requested';

export const hasCompleteFiche = (record: SponsorshipAttentionRecord): boolean =>
  record.detailsSubmittedAt !== null &&
  record.hasCompanyName &&
  record.hasContactEmail &&
  record.hasSupportingImage;

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

// ---------------------------------------------------------------------------
// Detector: sponsorship paid but fiche incomplete.
// ---------------------------------------------------------------------------
export const detectSponsorshipInfoItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  dataset.sponsorships
    .filter(
      (record) => isActionableSponsorship(record) && !hasCompleteFiche(record)
    )
    .map((record) => {
      const ageDays = daysBetween(dataset.now, record.paidAt);
      const missing = missingFicheFields(record);
      return {
        id: `sponsorship_needs_info:${record.contributionId}`,
        type: 'sponsorship_needs_info',
        severity: severityForAge(ageDays, 7, 2),
        title: `Commandite payée sans fiche complète (${sponsorshipRef(record)})`,
        explanation:
          `Une commandite de ${record.amount} ${record.currency} est payée ` +
          `mais sa fiche commanditaire est incomplète. ` +
          `Éléments manquants : ${missing.join(', ')}.`,
        sponsorshipId: record.contributionId,
        contributionId: record.contributionId,
        detectedAt: dataset.now.toISOString(),
        adminUrl: ADMIN_URLS.sponsors,
        facts: {
          reference: sponsorshipRef(record),
          amount: record.amount,
          currency: record.currency,
          paidAt: record.paidAt,
          daysSincePaid: ageDays,
          detailsSubmitted: record.detailsSubmittedAt !== null,
          missingFields: missing.join(', ')
        },
        suggestedActions: [
          {
            actionType: 'prepare_reminder',
            label: 'Préparer une relance',
            executionMode: 'prepare'
          },
          {
            actionType: 'open_sponsorship',
            label: 'Ouvrir la commandite',
            executionMode: 'navigate'
          }
        ]
      } satisfies AdminAttentionItem;
    });

// ---------------------------------------------------------------------------
// Detector: sponsorship complete, awaiting an administrative review decision.
// ---------------------------------------------------------------------------
export const detectSponsorshipReviewItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  dataset.sponsorships
    .filter(
      (record) =>
        isActionableSponsorship(record) &&
        hasCompleteFiche(record) &&
        record.reviewStatus === 'pending_review'
    )
    .map((record) => {
      const ageDays = daysBetween(
        dataset.now,
        record.detailsSubmittedAt ?? record.paidAt
      );
      return {
        id: `sponsorship_needs_review:${record.contributionId}`,
        type: 'sponsorship_needs_review',
        severity: severityForAge(ageDays, 7, 3),
        title: `Commandite en attente de revue (${sponsorshipRef(record)})`,
        explanation:
          `Une commandite de ${record.amount} ${record.currency} a une fiche ` +
          `complète mais aucune décision administrative (approbation ou refus) ` +
          `n'a encore été enregistrée.`,
        sponsorshipId: record.contributionId,
        contributionId: record.contributionId,
        detectedAt: dataset.now.toISOString(),
        adminUrl: ADMIN_URLS.sponsors,
        facts: {
          reference: sponsorshipRef(record),
          amount: record.amount,
          currency: record.currency,
          detailsSubmittedAt: record.detailsSubmittedAt,
          daysWaiting: ageDays
        },
        suggestedActions: [
          {
            actionType: 'prepare_note',
            label: 'Préparer une note',
            executionMode: 'prepare'
          },
          {
            actionType: 'review_sponsorship',
            label: 'Réviser la commandite',
            executionMode: 'navigate'
          }
        ]
      } satisfies AdminAttentionItem;
    });

// ---------------------------------------------------------------------------
// Detector: approved sponsorship whose promised social publications are not
// yet covered by an active draft. Publication benefits are derived server-side
// from the amount actually paid (Facebook >= 250, LinkedIn >= 500).
// ---------------------------------------------------------------------------
export const activeDraftChannels = (
  drafts: readonly AdminPublicationDraftRecord[],
  contributionId: string
): ReadonlySet<SponsorFeedChannel> => {
  const channels = new Set<SponsorFeedChannel>();
  for (const draft of drafts) {
    if (
      draft.contribution_id === contributionId &&
      draft.status !== 'rejected' &&
      draft.status !== 'cancelled'
    ) {
      channels.add(draft.channel);
    }
  }
  return channels;
};

export const detectPublicationPreparationItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  dataset.sponsorships
    .filter(
      (record) =>
        isActionableSponsorship(record) && record.reviewStatus === 'approved'
    )
    .flatMap((record) => {
      const promised = promisedSocialChannels(record.amount);
      if (promised.length === 0) {
        return [];
      }
      const covered = activeDraftChannels(
        dataset.drafts,
        record.contributionId
      );
      const missingChannels = promised.filter(
        (channel) => !covered.has(channel)
      );
      if (missingChannels.length === 0) {
        return [];
      }
      return [
        {
          id: `publication_needs_preparation:${record.contributionId}`,
          type: 'publication_needs_preparation',
          severity: 'this_week',
          title: `Publication à préparer (${sponsorshipRef(record)})`,
          explanation:
            `Cette commandite approuvée de ${record.amount} ${record.currency} ` +
            `prévoit des publications (${promised.join(', ')}). Aucun brouillon ` +
            `actif ne couvre encore : ${missingChannels.join(', ')}.`,
          sponsorshipId: record.contributionId,
          contributionId: record.contributionId,
          detectedAt: dataset.now.toISOString(),
          adminUrl: ADMIN_URLS.publications,
          facts: {
            reference: sponsorshipRef(record),
            amount: record.amount,
            currency: record.currency,
            promisedChannels: promised.join(', '),
            missingChannels: missingChannels.join(', ')
          },
          suggestedActions: [
            {
              actionType: 'prepare_publication',
              label: 'Préparer le brouillon de publication',
              executionMode: 'prepare'
            },
            {
              actionType: 'open_publications',
              label: 'Ouvrir les publications',
              executionMode: 'navigate'
            }
          ]
        } satisfies AdminAttentionItem
      ];
    });

// ---------------------------------------------------------------------------
// Detector: publications past their scheduled time that are neither published
// nor cancelled. Sourced from slots and batches (they carry the schedule).
// ---------------------------------------------------------------------------
export const detectLatePublicationItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] => {
  const items: AdminAttentionItem[] = [];

  for (const slot of dataset.slots) {
    if (slot.status !== 'open' && slot.status !== 'scheduled') {
      continue;
    }
    const daysLate = daysBetween(dataset.now, slot.startsAt);
    if (daysLate === null || daysLate < 0) {
      continue;
    }
    items.push({
      id: `publication_late:slot:${slot.id}`,
      type: 'publication_late',
      severity: severityForAge(daysLate, 2, 0),
      title: `Créneau de publication dépassé (${slot.channel} · ${slot.feedTarget})`,
      explanation:
        `Le créneau ${slot.channel}/${slot.feedTarget} prévu le ${slot.startsAt} ` +
        `est dépassé et n'est ni publié ni annulé (${slot.capacityUsed}/${slot.capacity} placements).`,
      publicationId: slot.id,
      detectedAt: dataset.now.toISOString(),
      dueAt: slot.startsAt,
      adminUrl: ADMIN_URLS.publications,
      facts: {
        kind: 'slot',
        channel: slot.channel,
        feedTarget: slot.feedTarget,
        startsAt: slot.startsAt,
        status: slot.status,
        daysLate,
        capacityUsed: slot.capacityUsed,
        capacity: slot.capacity
      },
      suggestedActions: [
        {
          actionType: 'propose_slot',
          label: 'Proposer un créneau',
          executionMode: 'prepare'
        },
        {
          actionType: 'open_publication_slot',
          label: 'Ouvrir le créneau',
          executionMode: 'navigate'
        }
      ]
    });
  }

  for (const batch of dataset.batches) {
    if (batch.status !== 'scheduled') {
      continue;
    }
    const daysLate = daysBetween(dataset.now, batch.scheduledAt);
    if (daysLate === null || daysLate < 0) {
      continue;
    }
    items.push({
      id: `publication_late:batch:${batch.id}`,
      type: 'publication_late',
      severity: severityForAge(daysLate, 2, 0),
      title: `Lot de publication dépassé (${batch.channel})`,
      explanation:
        `Le lot ${batch.channel} planifié le ${batch.scheduledAt} est dépassé ` +
        `et n'est ni publié ni annulé (${batch.capacityUsed}/${batch.capacity} placements).`,
      publicationId: batch.id,
      detectedAt: dataset.now.toISOString(),
      dueAt: batch.scheduledAt ?? undefined,
      adminUrl: ADMIN_URLS.publications,
      facts: {
        kind: 'batch',
        channel: batch.channel,
        scheduledAt: batch.scheduledAt,
        status: batch.status,
        daysLate,
        capacityUsed: batch.capacityUsed,
        capacity: batch.capacity
      },
      suggestedActions: [
        {
          actionType: 'open_publication_batch',
          label: 'Ouvrir le lot',
          executionMode: 'navigate'
        }
      ]
    });
  }

  return items;
};

// ---------------------------------------------------------------------------
// Detector: failed transactional emails. Never exposes the raw error string,
// recipient local-part, SMTP credentials or any secret.
// ---------------------------------------------------------------------------
const categorizeEmailError = (raw: string | null): string => {
  const text = (raw ?? '').toLowerCase();
  if (!text) {
    return 'inconnue';
  }
  if (
    text.includes('auth') ||
    text.includes('535') ||
    text.includes('credential') ||
    text.includes('password')
  ) {
    return 'authentification';
  }
  if (
    text.includes('550') ||
    text.includes('reject') ||
    text.includes('recipient') ||
    text.includes('mailbox') ||
    text.includes('no such user')
  ) {
    return 'destinataire_rejeté';
  }
  if (
    text.includes('timeout') ||
    text.includes('etimedout') ||
    text.includes('econn') ||
    text.includes('network')
  ) {
    return 'connexion';
  }
  return 'autre';
};

const recipientDomain = (email: string): string | null => {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : null;
};

export const detectFailedEmailItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  dataset.emailMessages
    .filter((message) => message.status === 'failed')
    .map((message) => {
      const exhausted = message.attempts >= message.max_attempts;
      return {
        id: `email_delivery_failed:${message.id}`,
        type: 'email_delivery_failed',
        severity: exhausted ? 'urgent' : 'today',
        title: `Courriel transactionnel en échec (${message.template_key})`,
        explanation:
          `L'envoi du courriel « ${message.template_key} » a échoué ` +
          `(${message.attempts}/${message.max_attempts} tentatives, ` +
          `cause : ${categorizeEmailError(message.last_error)})` +
          `${exhausted ? '. Les tentatives automatiques sont épuisées.' : '.'}`,
        emailQueueId: message.id,
        detectedAt: dataset.now.toISOString(),
        adminUrl: ADMIN_URLS.emailQueue,
        facts: {
          templateKey: message.template_key,
          recipientDomain: recipientDomain(message.recipient_email),
          attempts: message.attempts,
          maxAttempts: message.max_attempts,
          attemptsExhausted: exhausted,
          errorCategory: categorizeEmailError(message.last_error)
        },
        suggestedActions: [
          {
            actionType: 'retry_email',
            label: 'Revoir la file de courriels',
            executionMode: 'navigate'
          }
        ]
      } satisfies AdminAttentionItem;
    });

// ---------------------------------------------------------------------------
// Detector: reliably-identifiable financial warnings only. This is NOT a
// reconciliation engine; it flags conservative, obvious situations.
// ---------------------------------------------------------------------------
export const detectFinancialWarningItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] => {
  const items: AdminAttentionItem[] = [];
  const { financialTotals } = dataset;

  if (financialTotals.disputed > 0) {
    items.push({
      id: 'financial_data_warning:disputed',
      type: 'financial_data_warning',
      severity: 'today',
      title: 'Paiements en litige détectés',
      explanation:
        `Des paiements totalisant ${financialTotals.disputed} ` +
        `${financialTotals.currency} sont en litige (disputed). Le montant net ` +
        `réellement disponible pourrait être inférieur au montant brut affiché.`,
      detectedAt: dataset.now.toISOString(),
      adminUrl: ADMIN_URLS.transparency,
      facts: {
        disputedAmount: financialTotals.disputed,
        currency: financialTotals.currency
      },
      suggestedActions: [
        {
          actionType: 'open_transparency',
          label: 'Ouvrir la transparence financière',
          executionMode: 'navigate'
        }
      ]
    });
  }

  if (dataset.sponsorshipsTruncated) {
    items.push({
      id: 'financial_data_warning:truncated',
      type: 'financial_data_warning',
      severity: 'informational',
      title: 'Analyse des commandites partielle',
      explanation:
        `Le nombre de commandites dépasse la limite d'analyse de l'assistant. ` +
        `Certains dossiers peuvent ne pas apparaître dans cette file de travail.`,
      detectedAt: dataset.now.toISOString(),
      adminUrl: ADMIN_URLS.sponsors,
      facts: { truncated: true },
      suggestedActions: []
    });
  }

  return items;
};

// ---------------------------------------------------------------------------
// Aggregation.
// ---------------------------------------------------------------------------
const sortAttentionItems = (
  items: readonly AdminAttentionItem[]
): AdminAttentionItem[] =>
  [...items].sort((first, second) => {
    const bySeverity =
      SEVERITY_RANK[first.severity] - SEVERITY_RANK[second.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const firstDue = first.dueAt ?? first.detectedAt;
    const secondDue = second.dueAt ?? second.detectedAt;
    return firstDue.localeCompare(secondDue);
  });

export const buildAttentionItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  sortAttentionItems([
    ...detectSponsorshipInfoItems(dataset),
    ...detectSponsorshipReviewItems(dataset),
    ...detectPublicationPreparationItems(dataset),
    ...detectLatePublicationItems(dataset),
    ...detectFailedEmailItems(dataset),
    ...detectFinancialWarningItems(dataset)
  ]);

export const buildFinancialSummary = (
  dataset: AttentionDataset
): AdminAssistantFinancialSummary => {
  const { financialTotals, sponsorshipsTruncated } = dataset;
  const limitations = [
    'Les frais de traitement Stripe ne sont pas inclus dans ce résumé.',
    'Le montant net réel dépend des frais et des remboursements confirmés par Stripe.'
  ];
  if (financialTotals.disputed > 0) {
    limitations.push(
      'Des paiements en litige (disputed) peuvent réduire le montant net.'
    );
  }
  if (sponsorshipsTruncated) {
    limitations.push(
      "Le nombre de commandites dépasse la limite d'analyse; certaines peuvent être omises."
    );
  }

  return {
    grossPaid: financialTotals.grossPaid,
    processingFees: null,
    refunded: financialTotals.refunded,
    netReceived: null,
    currency: financialTotals.currency,
    limitations
  };
};

/**
 * Build the full admin assistant summary from an already-loaded dataset.
 * Counts are computed over ALL detected items/records; only the materialised
 * `attentionItems` array is capped by `maxAttentionItems`.
 */
export const buildSummaryFromDataset = (
  dataset: AttentionDataset,
  maxAttentionItems: number = DEFAULT_MAX_ATTENTION_ITEMS
): AdminAssistantSummary => {
  const items = buildAttentionItems(dataset);

  const countByType = (type: AdminAttentionItem['type']): number =>
    items.filter((item) => item.type === type).length;

  const approvedSponsorships = dataset.sponsorships.filter(
    (record) =>
      record.paymentStatus === 'paid' &&
      record.refundStatus === 'not_requested' &&
      record.reviewStatus === 'approved'
  ).length;

  const scheduledPublications =
    dataset.slots.filter((slot) => slot.status === 'scheduled').length +
    dataset.batches.filter((batch) => batch.status === 'scheduled').length;

  const failedEmails = dataset.emailMessages.filter(
    (message) => message.status === 'failed'
  ).length;

  return {
    generatedAt: dataset.now.toISOString(),
    counts: {
      urgent: items.filter((item) => item.severity === 'urgent').length,
      today: items.filter((item) => item.severity === 'today').length,
      thisWeek: items.filter((item) => item.severity === 'this_week').length,
      informational: items.filter((item) => item.severity === 'informational')
        .length
    },
    sponsorships: {
      needsInfo: countByType('sponsorship_needs_info'),
      needsReview: countByType('sponsorship_needs_review'),
      approved: approvedSponsorships
    },
    publications: {
      needsPreparation: countByType('publication_needs_preparation'),
      scheduled: scheduledPublications,
      late: countByType('publication_late')
    },
    emails: {
      failed: failedEmails
    },
    financialSummary: buildFinancialSummary(dataset),
    attentionItems: items.slice(0, Math.max(0, maxAttentionItems))
  };
};

export interface BuildAdminAssistantSummaryOptions {
  readonly now?: Date;
  readonly maxAttentionItems?: number;
}

/**
 * Load the required data from the existing repositories and build the
 * deterministic summary. Works with or without the AI provider — this is the
 * fallback that keeps the assistant useful when the model is disabled.
 */
export const loadAttentionDataset = async (
  pool: Pool | null,
  now: Date = new Date()
): Promise<AttentionDataset> => {
  const [sponsorships, drafts, batches, slots, emailQueue, dashboard] =
    await Promise.all([
      listSponsorshipsForAttention(pool),
      listAdminPublicationDrafts(pool),
      listAdminPublicationBatches(pool),
      listAdminPublicationSlots(pool),
      listAdminEmailQueue(pool),
      getAdminDashboard(pool)
    ]);

  return {
    now,
    sponsorships: sponsorships.items,
    sponsorshipsTruncated: sponsorships.truncated,
    drafts: drafts.drafts,
    batches: batches.batches,
    slots: slots.slots,
    emailMessages: emailQueue.messages,
    financialTotals: {
      grossPaid: dashboard.totals.total_received,
      refunded: dashboard.totals.total_refunded,
      disputed: dashboard.totals.total_disputed,
      currency: dashboard.totals.currency
    }
  };
};

export const buildAdminAssistantSummary = async (
  pool: Pool | null,
  options: BuildAdminAssistantSummaryOptions = {}
): Promise<AdminAssistantSummary> => {
  const now = options.now ?? new Date();
  const dataset = await loadAttentionDataset(pool, now);
  return buildSummaryFromDataset(
    dataset,
    options.maxAttentionItems ?? DEFAULT_MAX_ATTENTION_ITEMS
  );
};
