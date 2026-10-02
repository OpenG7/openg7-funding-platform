import { escapeHtml, formatDate, formatMoney } from './email-rendering.js';
import type {
  AdminContributionReceivedEmailInput,
  ContributionReferenceRecoveryEmailInput,
  EmailConfigurationTestInput,
  PublicationBatchFullEmailInput,
  RenderedEmail,
  SponsorshipReviewReminderEmailInput
} from './email-notification.types.js';
import type { SendTransactionalEmailInput } from './email.types.js';

interface SmtpConfigurationTestEmailInput {
  readonly fromAddress: string;
  readonly replyToAddress: string;
}

export const renderSmtpConfigurationTestEmail = (
  input: SmtpConfigurationTestEmailInput
): Omit<SendTransactionalEmailInput, 'to'> => ({
  subject: 'Test SMTP OpenG7',
  text: [
    'La configuration SMTP transactionnelle d OpenG7 fonctionne correctement.',
    '',
    `Expediteur : ${input.fromAddress}`,
    `Adresse de reponse : ${input.replyToAddress}`
  ].join('\n'),
  html: `
      <p>
        La configuration SMTP transactionnelle d'OpenG7 fonctionne correctement.
      </p>
      <p>
        <strong>Expediteur :</strong> ${input.fromAddress}<br />
        <strong>Adresse de reponse :</strong> ${input.replyToAddress}
      </p>
    `
});

const formatWaitingDays = (days: number | null): string => {
  if (days === null) {
    return 'age inconnu';
  }

  return `${days} jour${days > 1 ? 's' : ''}`;
};

const contributionTypeEmailLabel = (type: string): string =>
  type === 'sponsorship_interest' ? 'Commandite' : 'Contribution personnelle';

const contributionStatusEmailLabel = (status: string): string => {
  if (status === 'paid') {
    return 'confirmee';
  }

  if (status === 'refunded') {
    return 'remboursee';
  }

  if (status === 'disputed') {
    return 'contestee';
  }

  if (status === 'pending') {
    return 'en attente';
  }

  return status;
};

export const renderContributionReferenceRecoveryEmail = (
  input: ContributionReferenceRecoveryEmailInput
): RenderedEmail => {
  const subject = 'Vos references OpenG7';
  const referenceLines = input.references.flatMap((reference, index) => [
    `${index + 1}. ${reference.publicReference}`,
    `   Type: ${contributionTypeEmailLabel(reference.contributionType)}`,
    `   Montant: ${formatMoney(reference.amount, reference.currency)}`,
    `   Statut: ${contributionStatusEmailLabel(reference.paymentStatus)}`,
    `   Date: ${formatDate(reference.paidAt ?? reference.createdAt)}`,
    ...(reference.displayName ? [`   Nom: ${reference.displayName}`] : [])
  ]);
  const referenceHtml = input.references
    .map((reference) => {
      const displayName = reference.displayName?.trim();
      return `
        <li>
          <strong>${escapeHtml(reference.publicReference)}</strong><br />
          ${escapeHtml(contributionTypeEmailLabel(reference.contributionType))}
          - ${escapeHtml(formatMoney(reference.amount, reference.currency))}
          - ${escapeHtml(contributionStatusEmailLabel(reference.paymentStatus))}
          <br />
          <span>Date: ${escapeHtml(formatDate(reference.paidAt ?? reference.createdAt))}</span>
          ${
            displayName
              ? `<br /><span>Nom: ${escapeHtml(displayName)}</span>`
              : ''
          }
        </li>
      `;
    })
    .join('');

  const text = [
    'Bonjour,',
    '',
    'Voici les references OpenG7 associees a ce courriel:',
    '',
    ...referenceLines,
    '',
    "Si vous n'avez pas demande ce message, vous pouvez l'ignorer.",
    'Pour toute correction, repondez a ce courriel avec la reference concernee.'
  ].join('\n');
  const html = `
    <p>Bonjour,</p>
    <p>Voici les references OpenG7 associees a ce courriel:</p>
    <ol>
      ${referenceHtml}
    </ol>
    <p>
      Si vous n'avez pas demande ce message, vous pouvez l'ignorer.
    </p>
    <p>
      Pour toute correction, repondez a ce courriel avec la reference concernee.
    </p>
  `;

  return {
    templateKey: 'contribution_reference_recovery',
    subject,
    text,
    html,
    metadata: {
      publicReferences: input.references.map(
        (reference) => reference.publicReference
      ),
      referenceCount: input.references.length
    }
  };
};

export const renderPublicationBatchFullNotification = (
  input: PublicationBatchFullEmailInput
): RenderedEmail => {
  const channelLabel = escapeHtml(input.channel);
  const subject = `Lot ${input.channel} complet (${input.capacity}/${input.capacity})`;
  const text = [
    `Un lot de publication collective ${input.channel} a atteint sa capacite (${input.capacity}/${input.capacity}).`,
    '',
    'Planifiez ou publiez ce lot depuis /admin/fundraiser/publications, ou creez un nouveau lot pour les prochaines commandites approuvees.'
  ].join('\n');
  const html = `
    <p>
      Un lot de publication collective <strong>${channelLabel}</strong> a
      atteint sa capacite (${input.capacity}/${input.capacity}).
    </p>
    <p>
      Planifiez ou publiez ce lot depuis
      <code>/admin/fundraiser/publications</code>, ou creez un nouveau lot
      pour les prochaines commandites approuvees.
    </p>
  `;

  return {
    templateKey: 'publication_batch_full',
    subject,
    text,
    html,
    metadata: {
      batchId: input.batchId ?? null,
      capacity: input.capacity,
      channel: input.channel
    }
  };
};

export const renderSponsorshipReviewReminderNotification = (
  input: SponsorshipReviewReminderEmailInput
): RenderedEmail => {
  let linkedAdminUrl = false;
  try {
    const url = new URL(input.adminUrl);
    linkedAdminUrl =
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password;
  } catch {
    // Retain the navigation path when no public origin is configured.
  }
  const countLabel = `${input.totalCount} commandite${
    input.totalCount > 1 ? 's' : ''
  }`;
  const subject = `Rappel: ${countLabel} a approuver`;
  const oldestLabel = formatWaitingDays(input.oldestDaysWaiting);
  const itemLines = input.items.flatMap((item, index) => [
    `${index + 1}. ${item.reference}`,
    `   Montant: ${formatMoney(item.amount, item.currency)}`,
    `   Fiche soumise: ${formatDate(item.detailsSubmittedAt)}`,
    `   En attente: ${formatWaitingDays(item.daysWaiting)}`
  ]);
  const text = [
    `Il y a ${countLabel} payee${input.totalCount > 1 ? 's' : ''} avec fiche complete en attente de revue admin.`,
    `Plus ancienne attente: ${oldestLabel}.`,
    input.urgentCount > 0
      ? `${input.urgentCount} commandite${input.urgentCount > 1 ? 's' : ''} depasse${input.urgentCount > 1 ? 'nt' : ''} le seuil urgent.`
      : 'Aucune commandite ne depasse le seuil urgent.',
    '',
    ...itemLines,
    '',
    `Ouvrir les commandites: ${input.adminUrl}`,
    '',
    'Ce rappel est informatif. Il ne valide, ne refuse et ne publie aucune commandite.'
  ].join('\n');
  const htmlItems = input.items
    .map(
      (item) => `
        <li>
          <strong>${escapeHtml(item.reference)}</strong><br />
          Montant: ${escapeHtml(formatMoney(item.amount, item.currency))}<br />
          Fiche soumise: ${escapeHtml(formatDate(item.detailsSubmittedAt))}<br />
          En attente: ${escapeHtml(formatWaitingDays(item.daysWaiting))}
        </li>
      `
    )
    .join('');
  const html = `
    <p>
      Il y a <strong>${escapeHtml(countLabel)}</strong> payee${
        input.totalCount > 1 ? 's' : ''
      } avec fiche complete en attente de revue admin.
    </p>
    <p>Plus ancienne attente: ${escapeHtml(oldestLabel)}.</p>
    <p>
      ${
        input.urgentCount > 0
          ? `${input.urgentCount} commandite${
              input.urgentCount > 1 ? 's' : ''
            } depasse${input.urgentCount > 1 ? 'nt' : ''} le seuil urgent.`
          : 'Aucune commandite ne depasse le seuil urgent.'
      }
    </p>
    <ul>${htmlItems}</ul>
    <p>
      Ouvrir les commandites:
      ${
        linkedAdminUrl
          ? `<a href="${escapeHtml(input.adminUrl)}">Reprendre la revue des commandites</a>`
          : `<code>${escapeHtml(input.adminUrl)}</code>`
      }
    </p>
    <p>
      Ce rappel est informatif. Il ne valide, ne refuse et ne publie aucune
      commandite.
    </p>
  `;

  return {
    templateKey: 'sponsorship_review_reminder',
    subject,
    text,
    html,
    metadata: {
      totalCount: input.totalCount,
      urgentCount: input.urgentCount,
      oldestDaysWaiting: input.oldestDaysWaiting,
      displayedCount: input.items.length,
      adminUrl: input.adminUrl
    }
  };
};

export const renderEmailConfigurationTest = (
  input: EmailConfigurationTestInput
): RenderedEmail => {
  const subject = 'Test courriel OpenG7';
  const text = [
    'Ceci est un test de configuration courriel OpenG7.',
    '',
    `Destinataire: ${input.to}`,
    '',
    'Si vous recevez ce message, SMTP, l expediteur et la file courriel fonctionnent.'
  ].join('\n');
  const html = `
    <p>Ceci est un test de configuration courriel OpenG7.</p>
    <p><strong>Destinataire:</strong> ${escapeHtml(input.to)}</p>
    <p>
      Si vous recevez ce message, SMTP, l'expediteur et la file courriel
      fonctionnent.
    </p>
  `;

  return {
    templateKey: 'email_configuration_test',
    subject,
    text,
    html,
    metadata: {
      purpose: 'admin_setup_test'
    }
  };
};

export const renderAdminContributionReceivedEmail = (
  input: AdminContributionReceivedEmailInput
): RenderedEmail => {
  const amount = new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: input.currency
  }).format(input.amountMinor / 100);
  const subject = `Contribution reçue — ${amount}`;
  const text = `${input.reference} : paiement confirmé de ${amount}.\nLa préparation reste privée et nécessite une validation administrative.\n${input.adminUrl}`;
  return {
    templateKey: 'admin_contribution_received',
    subject,
    text,
    html: '<p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>',
    metadata: {
      contributionId: input.contributionId,
      activityId: input.activityId
    }
  };
};
