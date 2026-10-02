import type { AdminSponsorshipRejectionRefundHandling } from '@openg7/funding-core';

import { formatSponsorshipBenefitList } from '../../sponsorship-benefits.js';

import { escapeHtml, formatDate, formatMoney } from './email-rendering.js';
import type {
  RenderedEmail,
  SponsorshipAccessEmailInput,
  SponsorshipConfirmationEmailInput,
  SponsorshipFollowupEmailInput,
  SponsorshipInformationRequestEmailInput,
  SponsorshipRejectionEmailInput,
  SponsorshipRefundEmailInput
} from './email-notification.types.js';

const rejectionRefundHandlingLabel = (
  handling: AdminSponsorshipRejectionRefundHandling
): string => {
  if (handling === 'manual_required') {
    return 'Un remboursement sera traite separement par notre equipe.';
  }

  if (handling === 'manual_completed') {
    return 'Le remboursement a ete marque comme deja traite par notre equipe.';
  }

  return 'Aucun remboursement automatique n est declenche par ce message.';
};

export const renderSponsorshipFollowupEmail = (
  input: SponsorshipFollowupEmailInput
): RenderedEmail => {
  const reference = input.publicReference ?? 'Reference a confirmer';
  const safeUrl = escapeHtml(input.followupUrl);
  const subject = 'Votre commandite OpenG7 est en validation';
  const text = [
    'Merci pour votre commandite OpenG7.',
    '',
    `Reference OpenG7: ${reference}`,
    '',
    'Vous pouvez reprendre votre formulaire et suivre le statut ici:',
    input.followupUrl,
    '',
    'Aucune visibilite publique n est accordee avant validation manuelle.'
  ].join('\n');
  const html = `
    <p>Merci pour votre commandite OpenG7.</p>
    <p>
      <strong>Reference OpenG7:</strong> ${escapeHtml(reference)}
    </p>
    <p>
      Vous pouvez reprendre votre formulaire et suivre le statut ici:
      <br />
      <a href="${safeUrl}">${safeUrl}</a>
    </p>
    <p>
      Aucune visibilite publique n'est accordee avant validation manuelle.
    </p>
  `;

  return {
    templateKey: 'sponsorship_followup',
    subject,
    text,
    html,
    metadata: {
      publicReference: input.publicReference
    }
  };
};

export const renderSponsorshipConfirmationEmail = (
  input: SponsorshipConfirmationEmailInput
): RenderedEmail => {
  const reference = input.publicReference ?? 'Reference a confirmer';
  const amount = formatMoney(input.amount, input.currency);
  const paidAt = formatDate(input.paidAtIso);
  const safeFollowupUrl = escapeHtml(input.followupUrl);
  const benefits = formatSponsorshipBenefitList(input.amount, input.currency);
  const escapedBenefits = benefits.map((benefit) => escapeHtml(benefit));
  const subject = `Confirmation de commandite OpenG7 - ${reference}`;
  const text = [
    'Merci pour votre commandite OpenG7.',
    '',
    `Reference: ${reference}`,
    `Montant confirme: ${amount}`,
    `Date du paiement: ${paidAt}`,
    '',
    'Avantages associes au montant, sous reserve de validation manuelle:',
    ...benefits.map((benefit) => `- ${benefit}`),
    '',
    'Prochaine etape:',
    input.followupUrl,
    '',
    'Ce message est une confirmation descriptive de commandite. Il ne constitue pas un recu officiel de don de bienfaisance.',
    'Aucune visibilite publique n est accordee avant validation manuelle.'
  ].join('\n');
  const html = `
    <p>Merci pour votre commandite OpenG7.</p>
    <p>
      <strong>Reference:</strong> ${escapeHtml(reference)}<br />
      <strong>Montant confirme:</strong> ${escapeHtml(amount)}<br />
      <strong>Date du paiement:</strong> ${escapeHtml(paidAt)}
    </p>
    <p>
      Avantages associes au montant, sous reserve de validation manuelle:
    </p>
    <ul>
      ${escapedBenefits.map((benefit) => `<li>${benefit}</li>`).join('')}
    </ul>
    <p>
      Prochaine etape:
      <br />
      <a href="${safeFollowupUrl}">${safeFollowupUrl}</a>
    </p>
    <p>
      Ce message est une confirmation descriptive de commandite. Il ne
      constitue pas un recu officiel de don de bienfaisance.
    </p>
    <p>
      Aucune visibilite publique n'est accordee avant validation manuelle.
    </p>
  `;

  return {
    templateKey: 'sponsorship_confirmation',
    subject,
    text,
    html,
    metadata: {
      amount: input.amount,
      currency: input.currency,
      paidAtIso: input.paidAtIso,
      publicReference: input.publicReference,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeSessionId: input.stripeSessionId
    }
  };
};

export const renderSponsorshipRejectionEmail = (
  input: SponsorshipRejectionEmailInput
): RenderedEmail => {
  const reference = input.publicReference ?? 'Reference a confirmer';
  const amount = formatMoney(input.amount, input.currency);
  const refundLabel = rejectionRefundHandlingLabel(input.refundHandling);
  const refundNote = input.refundNote?.trim() ?? '';
  const subject = `Decision concernant votre commandite OpenG7 - ${reference}`;
  const text = [
    `Bonjour ${input.sponsorName},`,
    '',
    'Nous avons termine la revue de votre commandite OpenG7.',
    '',
    `Reference: ${reference}`,
    `Montant: ${amount}`,
    '',
    'Decision: commandite refusee.',
    '',
    'Message de notre equipe:',
    input.sponsorMessage,
    '',
    'Motif de revue:',
    input.reviewReason,
    '',
    'Remboursement:',
    refundLabel,
    ...(refundNote ? ['', 'Note remboursement:', refundNote] : []),
    '',
    'Vous pouvez repondre a ce courriel si vous souhaitez clarifier la situation.'
  ].join('\n');
  const html = `
    <p>Bonjour ${escapeHtml(input.sponsorName)},</p>
    <p>Nous avons termine la revue de votre commandite OpenG7.</p>
    <p>
      <strong>Reference:</strong> ${escapeHtml(reference)}<br />
      <strong>Montant:</strong> ${escapeHtml(amount)}<br />
      <strong>Decision:</strong> commandite refusee
    </p>
    <p><strong>Message de notre equipe</strong></p>
    <p>${escapeHtml(input.sponsorMessage).replaceAll('\n', '<br />')}</p>
    <p><strong>Motif de revue</strong></p>
    <p>${escapeHtml(input.reviewReason).replaceAll('\n', '<br />')}</p>
    <p>
      <strong>Remboursement:</strong>
      ${escapeHtml(refundLabel)}
    </p>
    ${
      refundNote
        ? `<p><strong>Note remboursement:</strong> ${escapeHtml(refundNote)}</p>`
        : ''
    }
    <p>
      Vous pouvez repondre a ce courriel si vous souhaitez clarifier la
      situation.
    </p>
  `;

  return {
    templateKey: 'sponsorship_rejection',
    subject,
    text,
    html,
    metadata: {
      amount: input.amount,
      contributionId: input.contributionId,
      currency: input.currency,
      publicReference: input.publicReference,
      refundHandling: input.refundHandling
    }
  };
};

export const renderSponsorshipRefundEmail = (
  input: SponsorshipRefundEmailInput
): RenderedEmail => {
  const reference = input.publicReference ?? 'Reference a confirmer';
  const amount = formatMoney(input.amount, input.currency);
  const refundStatus = input.refundStatus ?? 'cree';
  const refundNote = input.refundNote?.trim() ?? '';
  const subject = `Remboursement de votre commandite OpenG7 - ${reference}`;
  const text = [
    `Bonjour ${input.sponsorName},`,
    '',
    'Nous confirmons qu un remboursement Stripe a ete cree pour votre commandite OpenG7.',
    '',
    `Reference: ${reference}`,
    `Montant rembourse: ${amount}`,
    `Remboursement Stripe: ${input.refundId}`,
    `Statut Stripe: ${refundStatus}`,
    '',
    'Message de notre equipe:',
    input.sponsorMessage,
    ...(refundNote ? ['', 'Note remboursement:', refundNote] : []),
    '',
    'Selon votre institution financiere, le credit peut prendre quelques jours ouvrables avant d apparaitre.'
  ].join('\n');
  const html = `
    <p>Bonjour ${escapeHtml(input.sponsorName)},</p>
    <p>
      Nous confirmons qu'un remboursement Stripe a ete cree pour votre
      commandite OpenG7.
    </p>
    <p>
      <strong>Reference:</strong> ${escapeHtml(reference)}<br />
      <strong>Montant rembourse:</strong> ${escapeHtml(amount)}<br />
      <strong>Remboursement Stripe:</strong> ${escapeHtml(input.refundId)}<br />
      <strong>Statut Stripe:</strong> ${escapeHtml(refundStatus)}
    </p>
    <p><strong>Message de notre equipe</strong></p>
    <p>${escapeHtml(input.sponsorMessage).replaceAll('\n', '<br />')}</p>
    ${
      refundNote
        ? `<p><strong>Note remboursement:</strong> ${escapeHtml(refundNote)}</p>`
        : ''
    }
    <p>
      Selon votre institution financiere, le credit peut prendre quelques jours
      ouvrables avant d'apparaitre.
    </p>
  `;

  return {
    templateKey: 'sponsorship_refund',
    subject,
    text,
    html,
    metadata: {
      amount: input.amount,
      contributionId: input.contributionId,
      currency: input.currency,
      publicReference: input.publicReference,
      refundId: input.refundId,
      refundStatus: input.refundStatus
    }
  };
};

export const renderSponsorshipAccessEmail = (
  input: SponsorshipAccessEmailInput
): RenderedEmail => {
  const english = input.locale === 'en';
  const subject = english
    ? 'Your OpenG7 sponsorship access link'
    : 'Votre lien de suivi de commandite OpenG7';
  const intro = english
    ? 'Use this private link to resume your sponsorship. Your saved information and draft are preserved.'
    : 'Utilisez ce lien privé pour reprendre votre commandite. Vos informations et votre brouillon sauvegardés sont conservés.';
  const ignore = english
    ? 'If you did not request this email, you can ignore it. Do not share this link.'
    : 'Si vous n’avez pas demandé ce courriel, vous pouvez l’ignorer. Ne partagez pas ce lien.';
  const reference = input.reference ?? '';
  return {
    templateKey: 'sponsorship_access_recovery',
    subject,
    text: [intro, reference, input.url, ignore].join('\n\n'),
    html: `<p>${escapeHtml(intro)}</p><p>${escapeHtml(reference)}</p><p><a href="${escapeHtml(input.url)}">${english ? 'Resume my sponsorship' : 'Reprendre ma commandite'}</a></p><p>${escapeHtml(ignore)}</p>`,
    metadata: { publicReference: input.reference }
  };
};

export const renderSponsorshipInformationRequestEmail = (
  input: SponsorshipInformationRequestEmailInput
): RenderedEmail => ({
  templateKey: 'sponsorship_information_request',
  subject: input.subject,
  text: input.body,
  html: '<p>' + escapeHtml(input.body).replace(/\n/g, '<br>') + '</p>',
  metadata: { contributionId: input.contributionId }
});
