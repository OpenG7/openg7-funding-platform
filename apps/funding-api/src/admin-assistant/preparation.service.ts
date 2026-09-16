// Iteration 2: deterministic preparatory drafts for the admin assistant.
//
// GENERATION ONLY. Every function returns draft text the administrator can
// review; nothing is persisted, sent, published or executed. Each proposal is
// flagged `sent/published/persisted: false` and points to the existing admin
// screen where the human takes the real action. Refund preparation is out of
// scope for this iteration.

import type {
  AdminAssistantDraftProposal,
  AdminAssistantDraftType,
  AdminAssistantPrepareRequest,
  AdminAssistantPrepareResponse
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import type { SponsorshipAttentionRecord } from '../fund-contributions.repository.js';

import { loadSponsorshipAssistantDataset } from './context.repository.js';
import { canRequestSponsorshipInformation } from './context.service.js';
import {
  activeDraftChannels,
  hasCompleteFiche,
  isActionableSponsorship,
  loadAttentionDataset,
  missingFicheFields,
  promisedSocialChannels,
  sponsorshipAdminUrl,
  sponsorshipRef,
  type AttentionDataset
} from './attention.service.js';

const SLOT_PROPOSAL_LEAD_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MISSING_FIELD_LABELS: Record<string, string> = {
  formulaire_non_soumis: 'le formulaire de fiche commanditaire',
  nom_entreprise: "le nom de l'entreprise",
  courriel_contact: 'un courriel de contact',
  photo_presentation: 'une photo de presentation'
};

const ADMIN_URLS = {
  publications: '/admin/fundraiser/publications'
} as const;

const NOT_SENT_NOTICE =
  "Ce brouillon n'a pas été envoyé. Aucun courriel n'a été transmis. " +
  'Relisez-le puis envoyez-le via le flux de suivi existant.';
const NOT_PUBLISHED_NOTICE =
  "Ce brouillon n'a pas été publié. Aucune publication sociale n'a été créée. " +
  "Créez le brouillon via l'écran Publications après relecture.";
const NOT_SAVED_NOTICE =
  "Cette note n'a pas été enregistrée. Copiez-la dans la fiche si elle est pertinente.";
const NOT_CREATED_NOTICE =
  "Proposition indicative : aucun créneau n'a été créé. Ajustez la date puis " +
  "créez le créneau via l'écran Publications.";

const findSponsorship = (
  dataset: AttentionDataset,
  reference: string
): SponsorshipAttentionRecord | undefined => {
  const needle = reference.replace(/^#/, '').toLowerCase();
  return dataset.sponsorships.find(
    (candidate) =>
      candidate.publicReference?.toLowerCase() === reference.toLowerCase() ||
      candidate.contributionId.toLowerCase() === needle ||
      candidate.contributionId.toLowerCase().startsWith(needle)
  );
};

const notFound = (message: string): AdminAssistantPrepareResponse => ({
  status: 'not_found',
  draft: null,
  message
});

const notApplicable = (message: string): AdminAssistantPrepareResponse => ({
  status: 'not_applicable',
  draft: null,
  message
});

const ok = (
  draft: AdminAssistantDraftProposal
): AdminAssistantPrepareResponse => ({
  status: 'ok',
  draft,
  message: null
});

const baseDraft = (
  type: AdminAssistantDraftType,
  now: Date,
  reference: string | null
): Pick<
  AdminAssistantDraftProposal,
  'type' | 'generatedAt' | 'reference' | 'sent' | 'published' | 'persisted'
> => ({
  type,
  generatedAt: now.toISOString(),
  reference,
  sent: false,
  published: false,
  persisted: false
});

const prepareReminder = (
  dataset: AttentionDataset,
  record: SponsorshipAttentionRecord
): AdminAssistantPrepareResponse => {
  if (
    !isActionableSponsorship(record) ||
    record.reviewStatus === 'rejected' ||
    hasCompleteFiche(record)
  ) {
    return notApplicable(
      'La fiche de cette commandite est déjà complète ou non éligible à une relance.'
    );
  }

  const ref = sponsorshipRef(record);
  const missing = missingFicheFields(record).map(
    (field) => MISSING_FIELD_LABELS[field] ?? field
  );

  return ok({
    ...baseDraft('sponsorship_reminder', dataset.now, ref),
    title: `Relance — fiche commanditaire ${ref}`,
    fields: [
      {
        label: 'Objet',
        value: `Complétez votre fiche de commandite (${ref})`
      }
    ],
    bodyLines: [
      'Bonjour,',
      `Nous confirmons la réception de votre commandite de ${record.amount} ${record.currency}. Merci de votre soutien au Fonds des bâtisseurs OpenG7 !`,
      `Pour finaliser votre visibilité, il nous manque encore : ${missing.join(', ')}.`,
      'Vous pouvez compléter votre fiche via le lien de suivi qui vous a été transmis lors de votre commandite.',
      'Au plaisir,',
      "L'équipe OpenG7"
    ],
    adminUrl: sponsorshipAdminUrl(record.contributionId),
    notice: NOT_SENT_NOTICE,
    limitations: [
      'Brouillon générique : personnalisez le nom du contact avant envoi.'
    ]
  });
};

const preparePublication = (
  dataset: AttentionDataset,
  record: SponsorshipAttentionRecord
): AdminAssistantPrepareResponse => {
  if (!isActionableSponsorship(record) || record.reviewStatus !== 'approved') {
    return notApplicable(
      "Cette commandite n'est pas approuvée : aucune publication à préparer."
    );
  }

  const promised = promisedSocialChannels(record.amount);
  const covered = activeDraftChannels(dataset.drafts, record.contributionId);
  const missingChannels = promised.filter((channel) => !covered.has(channel));
  if (missingChannels.length === 0) {
    return notApplicable(
      'Les publications prévues sont déjà couvertes par un brouillon actif.'
    );
  }

  const ref = sponsorshipRef(record);
  return ok({
    ...baseDraft('publication_draft', dataset.now, ref),
    title: `Brouillon de publication — ${ref}`,
    fields: [
      { label: 'Canaux proposés', value: missingChannels.join(', ') },
      { label: 'Mention obligatoire', value: 'Publication commanditée' }
    ],
    bodyLines: [
      'Merci à {Nom de l’entreprise} pour son soutien au Fonds des bâtisseurs OpenG7 !',
      'Grâce à des commanditaires engagés, nous finançons des plateformes numériques publiques, ouvertes et transparentes.',
      'Publication commanditée. #OpenG7 #FondsDesBatisseurs'
    ],
    adminUrl: ADMIN_URLS.publications,
    notice: NOT_PUBLISHED_NOTICE,
    limitations: [
      'Remplacez {Nom de l’entreprise} par la raison sociale exacte avant publication.'
    ]
  });
};

const prepareNote = (
  dataset: AttentionDataset,
  record: SponsorshipAttentionRecord
): AdminAssistantPrepareResponse => {
  const ref = sponsorshipRef(record);
  const complete = hasCompleteFiche(record);
  return ok({
    ...baseDraft('admin_note', dataset.now, ref),
    title: `Note administrative — ${ref}`,
    fields: [
      { label: 'Paiement', value: record.paymentStatus },
      { label: 'Revue', value: record.reviewStatus },
      { label: 'Visibilité', value: record.feedStatus }
    ],
    bodyLines: [
      `Commandite ${ref} : ${record.amount} ${record.currency}, paiement ${record.paymentStatus}.`,
      `Revue : ${record.reviewStatus}. Fiche : ${complete ? 'complète' : 'incomplète'}. Visibilité : ${record.feedStatus}.`,
      complete
        ? 'Dossier prêt pour la prochaine étape administrative.'
        : 'Fiche à compléter avant toute décision de publication.'
    ],
    adminUrl: sponsorshipAdminUrl(record.contributionId),
    notice: NOT_SAVED_NOTICE,
    limitations: [
      "Note suggérée : vérifiez les informations avant de l'enregistrer."
    ]
  });
};

const prepareSlotProposal = (
  dataset: AttentionDataset,
  reference: string | undefined
): AdminAssistantPrepareResponse => {
  const lateSlots = dataset.slots
    .filter(
      (slot) =>
        (slot.status === 'open' || slot.status === 'scheduled') &&
        Date.parse(slot.startsAt) < dataset.now.getTime()
    )
    .sort((first, second) => first.startsAt.localeCompare(second.startsAt));

  const slot = reference
    ? lateSlots.find((candidate) => candidate.id === reference)
    : lateSlots[0];

  if (!slot) {
    return notApplicable(
      'Aucun créneau dépassé ne correspond à cette demande.'
    );
  }

  const proposedAt = new Date(
    dataset.now.getTime() + SLOT_PROPOSAL_LEAD_DAYS * MS_PER_DAY
  ).toISOString();

  return ok({
    ...baseDraft('slot_proposal', dataset.now, slot.id),
    title: `Proposition de créneau — ${slot.channel} / ${slot.feedTarget}`,
    fields: [
      { label: 'Canal', value: slot.channel },
      { label: 'Cible', value: slot.feedTarget },
      { label: 'Date proposée', value: proposedAt }
    ],
    bodyLines: [
      `Le créneau ${slot.channel}/${slot.feedTarget} prévu le ${slot.startsAt} est dépassé.`,
      `Créneau de remplacement suggéré : ${proposedAt} (${SLOT_PROPOSAL_LEAD_DAYS} jours).`,
      `Capacité actuelle : ${slot.capacityUsed}/${slot.capacity}.`
    ],
    adminUrl: ADMIN_URLS.publications,
    notice: NOT_CREATED_NOTICE,
    limitations: ['Date indicative : ajustez-la selon le calendrier éditorial.']
  });
};

export const prepareDraftFromDataset = (
  dataset: AttentionDataset,
  request: AdminAssistantPrepareRequest
): AdminAssistantPrepareResponse => {
  if (request.type === 'slot_proposal') {
    return prepareSlotProposal(dataset, request.reference);
  }

  const reference = request.reference?.trim();
  if (!reference) {
    return notFound('Une référence de commandite est requise.');
  }

  const record = findSponsorship(dataset, reference);
  if (!record) {
    return notFound(`Aucune commandite ne correspond à « ${reference} ».`);
  }

  switch (request.type) {
    case 'sponsorship_reminder':
      return prepareReminder(dataset, record);
    case 'publication_draft':
      return preparePublication(dataset, record);
    case 'admin_note':
      return prepareNote(dataset, record);
    default:
      return notApplicable('Type de brouillon non pris en charge.');
  }
};

export interface PrepareAdminAssistantDraftOptions {
  readonly now?: Date;
}

export const prepareAdminAssistantDraft = async (
  pool: Pool | null,
  request: AdminAssistantPrepareRequest,
  options: PrepareAdminAssistantDraftOptions = {}
): Promise<AdminAssistantPrepareResponse> => {
  const now = options.now ?? new Date();
  if (!pool)
    return {
      status: 'assistant_unavailable',
      draft: null,
      message: 'Assistant unavailable.'
    };
  if (request.type === 'slot_proposal') {
    return prepareDraftFromDataset(
      await loadAttentionDataset(pool, now, true),
      request
    );
  }
  const source = request.reference
    ? await loadSponsorshipAssistantDataset(pool, request.reference, now)
    : null;
  if (!source)
    return notFound(
      request.language === 'en'
        ? 'Sponsorship not found.'
        : 'Commandite introuvable.'
    );
  const result = prepareDraftFromDataset(source.dataset, {
    ...request,
    reference: source.record.contributionId
  });
  if (!result.draft) return result;
  const draft =
    request.language === 'en'
      ? englishDraft(result.draft, source.record)
      : result.draft;
  if (
    request.type !== 'sponsorship_reminder' ||
    !canRequestSponsorshipInformation(source)
  )
    return { ...result, draft };
  return {
    ...result,
    draft,
    delivery: {
      contributionId: source.record.contributionId,
      contextVersion: source.version,
      recipient: source.recipient!,
      subject: draft.fields[0]!.value,
      body: draft.bodyLines.join('\n\n')
    }
  };
};

/** Localised deterministic copy; no external model or side effects. */
const englishDraft = (
  draft: AdminAssistantDraftProposal,
  record: SponsorshipAttentionRecord
): AdminAssistantDraftProposal => {
  const reference = sponsorshipRef(record);
  if (draft.type === 'sponsorship_reminder') {
    const labels: Record<string, string> = {
      formulaire_non_soumis: 'the sponsor form',
      nom_entreprise: 'company name',
      courriel_contact: 'contact email',
      photo_presentation: 'a presentation image'
    };
    return {
      ...draft,
      title: `Information request — ${reference}`,
      fields: [
        {
          label: 'Subject',
          value: `Complete your sponsorship profile (${reference})`
        }
      ],
      bodyLines: [
        'Hello,',
        `Thank you for your sponsorship of ${record.amount} ${record.currency} in support of OpenG7!`,
        `We still need: ${missingFicheFields(record)
          .map((field) => labels[field])
          .join(', ')}.`,
        'Please complete your profile using the tracking link you received with your sponsorship.',
        'Thank you,',
        'The OpenG7 team'
      ],
      notice:
        'This draft has not been sent. Review it before confirming delivery.',
      limitations: ['Generic draft: personalise the message before sending.']
    };
  }
  if (draft.type === 'publication_draft')
    return {
      ...draft,
      title: `Publication draft — ${reference}`,
      fields: [
        { label: 'Suggested channels', value: draft.fields[0]!.value },
        { label: 'Required disclosure', value: 'Sponsored publication' }
      ],
      bodyLines: [
        'Thank you to {Company name} for supporting the OpenG7 Builders Fund!',
        'Your support helps fund open, transparent public digital platforms.',
        'Sponsored publication. #OpenG7'
      ],
      notice:
        'This draft has not been published or saved. Review it in Publications.',
      limitations: ['Replace {Company name} with the verified company name.']
    };
  return {
    ...draft,
    title: `Review note — ${reference}`,
    fields: [
      { label: 'Payment', value: record.paymentStatus },
      { label: 'Review', value: record.reviewStatus },
      { label: 'Visibility', value: record.feedStatus }
    ],
    bodyLines: [
      `Sponsorship ${reference}: ${record.amount} ${record.currency}.`,
      `Profile: ${hasCompleteFiche(record) ? 'complete' : 'incomplete'}.`,
      'Check the media, public consent and publication commitments before making a decision.'
    ],
    notice: 'This note has not been saved.',
    limitations: ['Verify these facts before saving the note.']
  };
};
