import type { Pool } from 'pg';
import type {
  AdminEmailQueueMessageRecord,
  AdminEmailQueueResponse,
  AdminEmailQueueSummary,
  AdminSponsorshipRejectionRefundHandling
} from '@openg7/funding-core';

import type {
  SponsorshipCreditNoteRecord,
  SponsorshipInvoiceRecord
} from './sponsorship-invoices.repository.js';

type EmailTemplateKey =
  | 'sponsorship_followup'
  | 'sponsorship_confirmation'
  | 'sponsorship_rejection'
  | 'sponsorship_refund'
  | 'sponsorship_invoice'
  | 'sponsorship_credit_note'
  | 'publication_batch_full'
  | 'email_configuration_test';

type EmailSponsorshipBenefitId =
  'website_mention' | 'facebook_batch' | 'linkedin_batch';

interface SponsorshipFollowupEmailInput {
  readonly to: string;
  readonly followupUrl: string;
  readonly idempotencyKey?: string;
}

interface SponsorshipConfirmationEmailInput {
  readonly to: string;
  readonly publicReference: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly paidAtIso: string | null;
  readonly followupUrl: string;
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly idempotencyKey?: string;
}

interface SponsorshipInvoiceEmailInput {
  readonly to: string;
  readonly invoice: SponsorshipInvoiceRecord;
  readonly followupUrl?: string;
  readonly idempotencyKey?: string;
}

interface SponsorshipCreditNoteEmailInput {
  readonly to: string;
  readonly creditNote: SponsorshipCreditNoteRecord;
  readonly sponsorMessage?: string;
  readonly idempotencyKey?: string;
}

interface SponsorshipRejectionEmailInput {
  readonly to: string;
  readonly contributionId: string;
  readonly publicReference: string | null;
  readonly sponsorName: string;
  readonly amount: number;
  readonly currency: string;
  readonly reviewReason: string;
  readonly sponsorMessage: string;
  readonly refundHandling: AdminSponsorshipRejectionRefundHandling;
  readonly refundNote?: string;
  readonly idempotencyKey?: string;
}

interface SponsorshipRefundEmailInput {
  readonly to: string;
  readonly contributionId: string;
  readonly publicReference: string | null;
  readonly sponsorName: string;
  readonly amount: number;
  readonly currency: string;
  readonly refundId: string;
  readonly refundStatus: string | null;
  readonly sponsorMessage: string;
  readonly refundNote?: string;
  readonly idempotencyKey?: string;
}

interface PublicationBatchFullEmailInput {
  readonly channel: string;
  readonly capacity: number;
  readonly batchId?: string;
  readonly idempotencyKey?: string;
}

interface EmailConfigurationTestInput {
  readonly to: string;
  readonly idempotencyKey?: string;
}

interface EmailSendResult {
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly error: string | null;
}

interface EmailQueueResult extends EmailSendResult {
  readonly queued: boolean;
  readonly duplicate: boolean;
  readonly messageId: string | null;
}

interface RenderedEmail {
  readonly templateKey: EmailTemplateKey;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly metadata: Record<string, unknown>;
}

interface QueueEmailInput extends RenderedEmail {
  readonly to: string;
  readonly idempotencyKey?: string;
  readonly maxAttempts?: number;
}

interface QueueInsertResult {
  readonly queued: boolean;
  readonly duplicate: boolean;
  readonly messageId: string | null;
  readonly status: string | null;
  readonly error: string | null;
}

interface ClaimedEmailRow {
  readonly id: string;
  readonly recipient_email: string;
  readonly from_email: string;
  readonly reply_to_email: string | null;
  readonly subject: string;
  readonly text_body: string;
  readonly html_body: string;
  readonly attempts: number;
  readonly max_attempts: number;
}

interface AdminEmailQueueMessageRow {
  readonly id: string;
  readonly template_key: string;
  readonly recipient_email: string;
  readonly from_email: string;
  readonly reply_to_email: string | null;
  readonly subject: string;
  readonly status: AdminEmailQueueMessageRecord['status'];
  readonly attempts: number;
  readonly max_attempts: number;
  readonly next_attempt_at: string;
  readonly sent_at: string | null;
  readonly last_error: string | null;
  readonly metadata: unknown;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AdminEmailQueueSummaryRow {
  readonly queued_count: number;
  readonly sending_count: number;
  readonly sent_count: number;
  readonly failed_count: number;
  readonly retryable_count: number;
  readonly last_failed_at: string | null;
  readonly last_error: string | null;
  readonly last_updated_at: string | null;
}

interface EmailQueueProcessOptions {
  readonly limit?: number;
  readonly messageIds?: readonly string[];
}

export interface EmailQueueProcessResult {
  readonly attempted: number;
  readonly sent: number;
  readonly failed: number;
  readonly messageIds: readonly string[];
  readonly sentMessageIds: readonly string[];
  readonly failedMessageIds: readonly string[];
}

export interface EmailQueueStatus {
  readonly queuedCount: number;
  readonly sendingCount: number;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly lastFailedAt: string | null;
  readonly lastError: string | null;
}

const resendApiKey = process.env.RESEND_API_KEY?.trim() ?? '';
const emailFrom = process.env.FUNDING_EMAIL_FROM?.trim() ?? '';
const emailReplyTo = process.env.FUNDING_EMAIL_REPLY_TO?.trim() ?? '';
const adminNotificationEmail =
  process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() ?? '';
const defaultMaxAttempts = 5;

const sponsorshipBenefitLabels: Record<EmailSponsorshipBenefitId, string> = {
  website_mention: 'Mention publique sur OpenG7.org apres validation',
  facebook_batch: 'Presence dans une publication collective Facebook',
  linkedin_batch: 'Presence dans une publication collective LinkedIn'
};
const sponsorshipBenefitThresholds: readonly {
  readonly id: EmailSponsorshipBenefitId;
  readonly minimumAmount: number;
}[] = [
  {
    id: 'website_mention',
    minimumAmount: 5
  },
  {
    id: 'facebook_batch',
    minimumAmount: 25
  },
  {
    id: 'linkedin_batch',
    minimumAmount: 50
  }
];

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatMoney = (amount: number, currency: string): string =>
  new Intl.NumberFormat('fr-CA', {
    currency: currency.toUpperCase(),
    style: 'currency'
  }).format(amount);

const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));

const formatDate = (iso: string | null): string => {
  if (!iso) {
    return 'Date non disponible';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Toronto'
  }).format(date);
};

const formatBenefitList = (amount: number): readonly string[] => {
  const benefits = sponsorshipBenefitThresholds
    .filter((benefit) => amount >= benefit.minimumAmount)
    .map((benefit) => benefit.id);

  if (benefits.length === 0) {
    return ['Aucun avantage de visibilite n est encore associe a ce montant.'];
  }

  return benefits.map((benefit) => sponsorshipBenefitLabels[benefit]);
};

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

const sendEmailPayload = async (input: {
  readonly to: string;
  readonly from: string;
  readonly replyTo: string | null;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}): Promise<EmailSendResult> => {
  if (!resendApiKey || !input.from) {
    return {
      attempted: false,
      sent: false,
      error: 'Email provider is not configured.'
    };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {})
      })
    });

    if (!response.ok) {
      return {
        attempted: true,
        sent: false,
        error: `Resend returned ${response.status}.`
      };
    }

    return {
      attempted: true,
      sent: true,
      error: null
    };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      error: error instanceof Error ? error.message : 'Email request failed.'
    };
  }
};

const renderSponsorshipFollowupEmail = (
  input: SponsorshipFollowupEmailInput
): RenderedEmail => {
  const safeUrl = escapeHtml(input.followupUrl);
  const subject = 'Votre commandite OpenG7 est en validation';
  const text = [
    'Merci pour votre commandite OpenG7.',
    '',
    'Vous pouvez reprendre votre formulaire et suivre le statut ici:',
    input.followupUrl,
    '',
    'Aucune visibilite publique n est accordee avant validation manuelle.'
  ].join('\n');
  const html = `
    <p>Merci pour votre commandite OpenG7.</p>
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
      followupUrl: input.followupUrl
    }
  };
};

const renderSponsorshipConfirmationEmail = (
  input: SponsorshipConfirmationEmailInput
): RenderedEmail => {
  const reference = input.publicReference ?? 'Reference a confirmer';
  const amount = formatMoney(input.amount, input.currency);
  const paidAt = formatDate(input.paidAtIso);
  const safeFollowupUrl = escapeHtml(input.followupUrl);
  const benefits = formatBenefitList(input.amount);
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

const renderSponsorshipRejectionEmail = (
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

const renderSponsorshipRefundEmail = (
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

const optionalText = (
  label: string,
  value: string | null | undefined
): readonly string[] => (value?.trim() ? [`${label}: ${value.trim()}`] : []);

const renderSponsorshipInvoiceEmail = (
  input: SponsorshipInvoiceEmailInput
): RenderedEmail => {
  const { invoice } = input;
  const publicReference = invoice.publicReference ?? 'Reference a confirmer';
  const subtotal = formatMoney(
    centsToAmount(invoice.subtotalCents),
    invoice.currency
  );
  const tax = formatMoney(centsToAmount(invoice.taxCents), invoice.currency);
  const total = formatMoney(
    centsToAmount(invoice.totalCents),
    invoice.currency
  );
  const issuedAt = formatDate(invoice.issuedAtIso);
  const paidAt = formatDate(invoice.paidAtIso);
  const followupUrl = input.followupUrl?.trim() ?? '';
  const safeFollowupUrl = escapeHtml(followupUrl);
  const followupText = followupUrl
    ? ['Suivi de la commandite:', followupUrl]
    : [
        'Pour mettre a jour les informations de commandite, repondez a ce courriel.'
      ];
  const followupHtml = followupUrl
    ? `
      <p>
        Suivi de la commandite:
        <br />
        <a href="${safeFollowupUrl}">${safeFollowupUrl}</a>
      </p>
    `
    : `
      <p>
        Pour mettre a jour les informations de commandite, repondez a ce
        courriel.
      </p>
    `;
  const lineItems = invoice.lineItems.length
    ? invoice.lineItems
    : [
        {
          description: 'Commandite de visibilite OpenG7 - Fonds des batisseurs',
          quantity: 1,
          unitAmountCents: invoice.subtotalCents,
          totalCents: invoice.subtotalCents
        }
      ];
  const subject = `Facture ${invoice.invoiceNumber} - Commandite OpenG7`;
  const issuerLines = [
    invoice.issuerName,
    ...optionalText('Courriel', invoice.issuerEmail),
    ...optionalText('Adresse', invoice.issuerAddress),
    ...optionalText('Identifiant fiscal', invoice.issuerTaxId)
  ];
  const sponsorLines = [
    invoice.sponsorName,
    ...optionalText('Contact', invoice.sponsorContactName),
    ...optionalText('Courriel', invoice.sponsorContactEmail),
    ...optionalText('Site web', invoice.sponsorWebsiteUrl)
  ];
  const text = [
    'Facture de commandite OpenG7',
    '',
    `Numero de facture: ${invoice.invoiceNumber}`,
    `Reference publique: ${publicReference}`,
    `Date d emission: ${issuedAt}`,
    `Date du paiement: ${paidAt}`,
    `Stripe Checkout Session: ${invoice.stripeSessionId}`,
    ...(invoice.stripePaymentIntentId
      ? [`Stripe Payment Intent: ${invoice.stripePaymentIntentId}`]
      : []),
    '',
    'Emetteur:',
    ...issuerLines,
    '',
    'Facture a:',
    ...sponsorLines,
    '',
    'Lignes:',
    ...lineItems.map(
      (item) =>
        `- ${item.description} x${item.quantity}: ${formatMoney(
          centsToAmount(item.totalCents),
          invoice.currency
        )}`
    ),
    '',
    `Sous-total: ${subtotal}`,
    `${invoice.taxLabel}: ${tax}`,
    `Total paye: ${total}`,
    '',
    invoice.notes ??
      'Ce document ne constitue pas un recu officiel de don de bienfaisance.',
    'La visibilite publique associee a cette commandite reste soumise a validation manuelle.',
    '',
    ...followupText
  ].join('\n');
  const htmlLineItems = lineItems
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.description)}</td>
          <td style="text-align:right;">${item.quantity}</td>
          <td style="text-align:right;">
            ${escapeHtml(
              formatMoney(centsToAmount(item.unitAmountCents), invoice.currency)
            )}
          </td>
          <td style="text-align:right;">
            ${escapeHtml(
              formatMoney(centsToAmount(item.totalCents), invoice.currency)
            )}
          </td>
        </tr>
      `
    )
    .join('');
  const html = `
    <h1>Facture de commandite OpenG7</h1>
    <p>
      <strong>Numero de facture:</strong> ${escapeHtml(invoice.invoiceNumber)}<br />
      <strong>Reference publique:</strong> ${escapeHtml(publicReference)}<br />
      <strong>Date d'emission:</strong> ${escapeHtml(issuedAt)}<br />
      <strong>Date du paiement:</strong> ${escapeHtml(paidAt)}
    </p>

    <table style="border-collapse:collapse;width:100%;margin:16px 0;">
      <tbody>
        <tr>
          <td style="border:1px solid #d9e0ea;padding:10px;vertical-align:top;">
            <strong>Emetteur</strong><br />
            ${issuerLines.map((line) => escapeHtml(line)).join('<br />')}
          </td>
          <td style="border:1px solid #d9e0ea;padding:10px;vertical-align:top;">
            <strong>Facture a</strong><br />
            ${sponsorLines.map((line) => escapeHtml(line)).join('<br />')}
          </td>
        </tr>
      </tbody>
    </table>

    <table style="border-collapse:collapse;width:100%;margin:16px 0;">
      <thead>
        <tr>
          <th style="border:1px solid #d9e0ea;padding:8px;text-align:left;">Description</th>
          <th style="border:1px solid #d9e0ea;padding:8px;text-align:right;">Qte</th>
          <th style="border:1px solid #d9e0ea;padding:8px;text-align:right;">Prix</th>
          <th style="border:1px solid #d9e0ea;padding:8px;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${htmlLineItems}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="border:1px solid #d9e0ea;padding:8px;text-align:right;">
            Sous-total
          </td>
          <td style="border:1px solid #d9e0ea;padding:8px;text-align:right;">
            ${escapeHtml(subtotal)}
          </td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #d9e0ea;padding:8px;text-align:right;">
            ${escapeHtml(invoice.taxLabel)}
          </td>
          <td style="border:1px solid #d9e0ea;padding:8px;text-align:right;">
            ${escapeHtml(tax)}
          </td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #d9e0ea;padding:8px;text-align:right;">
            <strong>Total paye</strong>
          </td>
          <td style="border:1px solid #d9e0ea;padding:8px;text-align:right;">
            <strong>${escapeHtml(total)}</strong>
          </td>
        </tr>
      </tfoot>
    </table>

    <p>
      ${escapeHtml(
        invoice.notes ??
          'Ce document ne constitue pas un recu officiel de don de bienfaisance.'
      )}
    </p>
    <p>
      La visibilite publique associee a cette commandite reste soumise a
      validation manuelle.
    </p>
    ${followupHtml}
  `;

  return {
    templateKey: 'sponsorship_invoice',
    subject,
    text,
    html,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      publicReference: invoice.publicReference,
      stripePaymentIntentId: invoice.stripePaymentIntentId,
      stripeSessionId: invoice.stripeSessionId
    }
  };
};

const renderSponsorshipCreditNoteEmail = (
  input: SponsorshipCreditNoteEmailInput
): RenderedEmail => {
  const { creditNote } = input;
  const publicReference = creditNote.publicReference ?? 'Reference a confirmer';
  const subtotal = formatMoney(
    centsToAmount(creditNote.subtotalCents),
    creditNote.currency
  );
  const tax = formatMoney(
    centsToAmount(creditNote.taxCents),
    creditNote.currency
  );
  const total = formatMoney(
    centsToAmount(creditNote.totalCents),
    creditNote.currency
  );
  const issuedAt = formatDate(creditNote.issuedAtIso);
  const sponsorMessage = input.sponsorMessage?.trim() ?? '';
  const lineItems = creditNote.lineItems.length
    ? creditNote.lineItems
    : [
        {
          description: 'Avoir - remboursement complet de la commandite OpenG7',
          quantity: 1,
          unitAmountCents: creditNote.subtotalCents,
          totalCents: creditNote.subtotalCents
        }
      ];
  const subject = `Avoir ${creditNote.creditNoteNumber} - Commandite OpenG7`;
  const issuerLines = [
    creditNote.issuerName,
    ...optionalText('Courriel', creditNote.issuerEmail),
    ...optionalText('Adresse', creditNote.issuerAddress),
    ...optionalText('Identifiant fiscal', creditNote.issuerTaxId)
  ];
  const sponsorLines = [
    creditNote.sponsorName,
    ...optionalText('Contact', creditNote.sponsorContactName),
    ...optionalText('Courriel', creditNote.sponsorContactEmail),
    ...optionalText('Site web', creditNote.sponsorWebsiteUrl)
  ];
  const text = [
    `Avoir: ${creditNote.creditNoteNumber}`,
    `Facture associee: ${creditNote.invoiceNumber}`,
    `Reference OpenG7: ${publicReference}`,
    `Date d emission: ${issuedAt}`,
    '',
    'Emetteur:',
    ...issuerLines,
    '',
    'Commanditaire:',
    ...sponsorLines,
    '',
    `Stripe Refund: ${creditNote.stripeRefundId}`,
    ...(creditNote.stripePaymentIntentId
      ? [`Stripe Payment Intent: ${creditNote.stripePaymentIntentId}`]
      : []),
    '',
    'Lignes:',
    ...lineItems.map(
      (item) =>
        `- ${item.description} | ${item.quantity} x ${formatMoney(
          centsToAmount(item.unitAmountCents),
          creditNote.currency
        )} = ${formatMoney(centsToAmount(item.totalCents), creditNote.currency)}`
    ),
    '',
    `Sous-total credite: ${subtotal}`,
    `${creditNote.taxLabel}: ${tax}`,
    `Total credite: ${total}`,
    '',
    ...(sponsorMessage ? ['Message de notre equipe:', sponsorMessage, ''] : []),
    creditNote.notes ??
      'Avoir de commandite descriptif emis apres remboursement Stripe. Ce document ne constitue pas un recu officiel de don de bienfaisance.'
  ].join('\n');
  const html = `
    <h1>Avoir de commandite OpenG7</h1>
    <p>
      <strong>Avoir:</strong> ${escapeHtml(creditNote.creditNoteNumber)}<br />
      <strong>Facture associee:</strong> ${escapeHtml(
        creditNote.invoiceNumber
      )}<br />
      <strong>Reference OpenG7:</strong> ${escapeHtml(publicReference)}<br />
      <strong>Date d'emission:</strong> ${escapeHtml(issuedAt)}
    </p>
    <h2>Emetteur</h2>
    <p>${issuerLines.map(escapeHtml).join('<br />')}</p>
    <h2>Commanditaire</h2>
    <p>${sponsorLines.map(escapeHtml).join('<br />')}</p>
    <p>
      <strong>Stripe Refund:</strong> ${escapeHtml(
        creditNote.stripeRefundId
      )}<br />
      ${
        creditNote.stripePaymentIntentId
          ? `<strong>Stripe Payment Intent:</strong> ${escapeHtml(
              creditNote.stripePaymentIntentId
            )}`
          : ''
      }
    </p>
    <table cellpadding="6" cellspacing="0" border="1">
      <thead>
        <tr>
          <th align="left">Description</th>
          <th align="right">Quantite</th>
          <th align="right">Unitaire</th>
          <th align="right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems
          .map(
            (item) => `
              <tr>
                <td>${escapeHtml(item.description)}</td>
                <td align="right">${item.quantity}</td>
                <td align="right">${escapeHtml(
                  formatMoney(
                    centsToAmount(item.unitAmountCents),
                    creditNote.currency
                  )
                )}</td>
                <td align="right">${escapeHtml(
                  formatMoney(
                    centsToAmount(item.totalCents),
                    creditNote.currency
                  )
                )}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
    <p>
      <strong>Sous-total credite:</strong> ${escapeHtml(subtotal)}<br />
      <strong>${escapeHtml(creditNote.taxLabel)}:</strong> ${escapeHtml(tax)}<br />
      <strong>Total credite:</strong> ${escapeHtml(total)}
    </p>
    ${
      sponsorMessage
        ? `<p><strong>Message de notre equipe:</strong><br />${escapeHtml(
            sponsorMessage
          ).replaceAll('\n', '<br />')}</p>`
        : ''
    }
    <p>
      ${escapeHtml(
        creditNote.notes ??
          'Avoir de commandite descriptif emis apres remboursement Stripe. Ce document ne constitue pas un recu officiel de don de bienfaisance.'
      )}
    </p>
  `;

  return {
    templateKey: 'sponsorship_credit_note',
    subject,
    text,
    html,
    metadata: {
      creditNoteId: creditNote.id,
      creditNoteNumber: creditNote.creditNoteNumber,
      invoiceId: creditNote.invoiceId,
      invoiceNumber: creditNote.invoiceNumber,
      publicReference: creditNote.publicReference,
      stripeRefundId: creditNote.stripeRefundId,
      stripePaymentIntentId: creditNote.stripePaymentIntentId
    }
  };
};

const renderPublicationBatchFullNotification = (
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

const renderEmailConfigurationTest = (
  input: EmailConfigurationTestInput
): RenderedEmail => {
  const subject = 'Test courriel OpenG7';
  const text = [
    'Ceci est un test de configuration courriel OpenG7.',
    '',
    `Destinataire: ${input.to}`,
    '',
    'Si vous recevez ce message, Resend, l expediteur et la file courriel fonctionnent.'
  ].join('\n');
  const html = `
    <p>Ceci est un test de configuration courriel OpenG7.</p>
    <p><strong>Destinataire:</strong> ${escapeHtml(input.to)}</p>
    <p>
      Si vous recevez ce message, Resend, l'expediteur et la file courriel
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

const enqueueEmailMessage = async (
  pool: Pool | null,
  input: QueueEmailInput
): Promise<QueueInsertResult> => {
  if (!pool) {
    return {
      queued: false,
      duplicate: false,
      messageId: null,
      status: null,
      error: 'Email queue requires DATABASE_URL.'
    };
  }

  if (!emailFrom) {
    return {
      queued: false,
      duplicate: false,
      messageId: null,
      status: null,
      error: 'Email sender is not configured.'
    };
  }

  const insert = await pool.query<{ id: string }>(
    `
      INSERT INTO email_messages (
        idempotency_key,
        template_key,
        recipient_email,
        from_email,
        reply_to_email,
        subject,
        text_body,
        html_body,
        metadata,
        max_attempts
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `,
    [
      input.idempotencyKey ?? null,
      input.templateKey,
      input.to,
      emailFrom,
      emailReplyTo || null,
      input.subject,
      input.text,
      input.html,
      JSON.stringify(input.metadata),
      input.maxAttempts ?? defaultMaxAttempts
    ]
  );

  const inserted = insert.rows[0];
  if (inserted) {
    return {
      queued: true,
      duplicate: false,
      messageId: inserted.id,
      status: 'queued',
      error: null
    };
  }

  if (!input.idempotencyKey) {
    return {
      queued: false,
      duplicate: false,
      messageId: null,
      status: null,
      error: 'Email message was not queued.'
    };
  }

  const existing = await pool.query<{ id: string; status: string }>(
    `
      SELECT id, status
      FROM email_messages
      WHERE idempotency_key = $1
      LIMIT 1
    `,
    [input.idempotencyKey]
  );
  const row = existing.rows[0] ?? null;

  return {
    queued: row?.status !== 'sent',
    duplicate: true,
    messageId: row?.id ?? null,
    status: row?.status ?? null,
    error: null
  };
};

const hasEmailMessagesTable = async (pool: Pool): Promise<boolean> => {
  const result = await pool.query<{ readonly has_email_messages: boolean }>(`
    SELECT to_regclass('public.email_messages') IS NOT NULL AS has_email_messages
  `);

  return result.rows[0]?.has_email_messages ?? false;
};

const mapAdminEmailQueueMessageRow = (
  row: AdminEmailQueueMessageRow
): AdminEmailQueueMessageRecord => ({
  id: row.id,
  template_key: row.template_key,
  recipient_email: row.recipient_email,
  from_email: row.from_email,
  reply_to_email: row.reply_to_email,
  subject: row.subject,
  status: row.status,
  attempts: row.attempts,
  max_attempts: row.max_attempts,
  next_attempt_at: row.next_attempt_at,
  sent_at: row.sent_at,
  last_error: row.last_error,
  metadata:
    typeof row.metadata === 'object' && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {},
  created_at: row.created_at,
  updated_at: row.updated_at
});

const emptyAdminEmailQueueResponse = (): AdminEmailQueueResponse => ({
  data_source: 'database',
  messages: [],
  summary: {
    queued_count: 0,
    sending_count: 0,
    sent_count: 0,
    failed_count: 0,
    retryable_count: 0,
    last_failed_at: null,
    last_error: null
  },
  last_updated_at: new Date().toISOString()
});

const adminEmailQueueMessageSelect = `
  id::text AS id,
  template_key,
  recipient_email,
  from_email,
  reply_to_email,
  subject,
  status,
  attempts::int AS attempts,
  max_attempts::int AS max_attempts,
  next_attempt_at::text AS next_attempt_at,
  sent_at::text AS sent_at,
  last_error,
  metadata,
  created_at::text AS created_at,
  updated_at::text AS updated_at
`;

export const getAdminEmailQueueMessageById = async (
  pool: Pool | null,
  messageId: string
): Promise<AdminEmailQueueMessageRecord | null> => {
  if (!pool || !(await hasEmailMessagesTable(pool))) {
    return null;
  }

  const result = await pool.query<AdminEmailQueueMessageRow>(
    `
      SELECT ${adminEmailQueueMessageSelect}
      FROM email_messages
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [messageId]
  );

  return result.rows[0] ? mapAdminEmailQueueMessageRow(result.rows[0]) : null;
};

export const listAdminEmailQueue = async (
  pool: Pool | null
): Promise<AdminEmailQueueResponse> => {
  if (!pool || !(await hasEmailMessagesTable(pool))) {
    return emptyAdminEmailQueueResponse();
  }

  const [messageResult, summaryResult] = await Promise.all([
    pool.query<AdminEmailQueueMessageRow>(`
      SELECT ${adminEmailQueueMessageSelect}
      FROM email_messages
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 150
    `),
    pool.query<AdminEmailQueueSummaryRow>(`
      WITH counts AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
          COUNT(*) FILTER (WHERE status = 'sending')::int AS sending_count,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
          COUNT(*) FILTER (
            WHERE status IN ('queued', 'failed')
              OR status = 'sending'
          )::int AS retryable_count,
          MAX(updated_at)::text AS last_updated_at
        FROM email_messages
      ),
      latest_failed AS (
        SELECT updated_at::text AS last_failed_at, last_error
        FROM email_messages
        WHERE status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 1
      )
      SELECT
        counts.queued_count,
        counts.sending_count,
        counts.sent_count,
        counts.failed_count,
        counts.retryable_count,
        latest_failed.last_failed_at,
        latest_failed.last_error,
        counts.last_updated_at
      FROM counts
      LEFT JOIN latest_failed ON TRUE
    `)
  ]);
  const summaryRow = summaryResult.rows[0];
  const summary: AdminEmailQueueSummary = {
    queued_count: summaryRow?.queued_count ?? 0,
    sending_count: summaryRow?.sending_count ?? 0,
    sent_count: summaryRow?.sent_count ?? 0,
    failed_count: summaryRow?.failed_count ?? 0,
    retryable_count: summaryRow?.retryable_count ?? 0,
    last_failed_at: summaryRow?.last_failed_at ?? null,
    last_error: summaryRow?.last_error ?? null
  };

  return {
    data_source: 'database',
    messages: messageResult.rows.map(mapAdminEmailQueueMessageRow),
    summary,
    last_updated_at: summaryRow?.last_updated_at ?? new Date().toISOString()
  };
};

export const getEmailQueueStatus = async (
  pool: Pool | null
): Promise<EmailQueueStatus> => {
  if (!pool) {
    return {
      queuedCount: 0,
      sendingCount: 0,
      sentCount: 0,
      failedCount: 0,
      lastFailedAt: null,
      lastError: null
    };
  }

  const result = await pool.query<{
    queued_count: number;
    sending_count: number;
    sent_count: number;
    failed_count: number;
    last_failed_at: string | null;
    last_error: string | null;
  }>(`
    WITH counts AS (
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
        COUNT(*) FILTER (WHERE status = 'sending')::int AS sending_count,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
      FROM email_messages
    ),
    latest_failed AS (
      SELECT updated_at::text AS last_failed_at, last_error
      FROM email_messages
      WHERE status = 'failed'
      ORDER BY updated_at DESC
      LIMIT 1
    )
    SELECT
      counts.queued_count,
      counts.sending_count,
      counts.sent_count,
      counts.failed_count,
      latest_failed.last_failed_at,
      latest_failed.last_error
    FROM counts
    LEFT JOIN latest_failed ON TRUE
  `);
  const row = result.rows[0];

  return {
    queuedCount: row?.queued_count ?? 0,
    sendingCount: row?.sending_count ?? 0,
    sentCount: row?.sent_count ?? 0,
    failedCount: row?.failed_count ?? 0,
    lastFailedAt: row?.last_failed_at ?? null,
    lastError: row?.last_error ?? null
  };
};

const claimQueuedEmailMessages = async (
  pool: Pool,
  options: Required<Pick<EmailQueueProcessOptions, 'limit'>> &
    Pick<EmailQueueProcessOptions, 'messageIds'>
): Promise<readonly ClaimedEmailRow[]> => {
  const params: unknown[] = [options.limit];
  const idFilter =
    options.messageIds && options.messageIds.length > 0
      ? 'AND id = ANY($2::uuid[])'
      : '';

  if (idFilter) {
    params.push(options.messageIds);
  }

  const query = await pool.query<ClaimedEmailRow>(
    `
      WITH selected AS (
        SELECT id
        FROM email_messages
        WHERE (
            (
              status IN ('queued', 'failed')
              AND next_attempt_at <= NOW()
            )
            OR (
              status = 'sending'
              AND updated_at <= NOW() - INTERVAL '15 minutes'
            )
          )
          AND attempts < max_attempts
          ${idFilter}
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      UPDATE email_messages
      SET
        status = 'sending',
        attempts = attempts + 1,
        updated_at = NOW()
      FROM selected
      WHERE email_messages.id = selected.id
      RETURNING
        email_messages.id,
        email_messages.recipient_email,
        email_messages.from_email,
        email_messages.reply_to_email,
        email_messages.subject,
        email_messages.text_body,
        email_messages.html_body,
        email_messages.attempts,
        email_messages.max_attempts
    `,
    params
  );

  return query.rows;
};

const nextRetryDate = (attempts: number, maxAttempts: number): Date | null => {
  if (attempts >= maxAttempts) {
    return null;
  }

  const delayMs = Math.min(
    60 * 60 * 1000,
    2 ** Math.max(0, attempts - 1) * 60 * 1000
  );
  return new Date(Date.now() + delayMs);
};

const markEmailSent = async (pool: Pool, messageId: string): Promise<void> => {
  await pool.query(
    `
      UPDATE email_messages
      SET
        status = 'sent',
        sent_at = NOW(),
        next_attempt_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [messageId]
  );
};

const markEmailFailed = async (
  pool: Pool,
  row: ClaimedEmailRow,
  error: string | null
): Promise<void> => {
  const nextAttemptAt = nextRetryDate(row.attempts, row.max_attempts);
  await pool.query(
    `
      UPDATE email_messages
      SET
        status = 'failed',
        next_attempt_at = COALESCE($2::timestamptz, next_attempt_at),
        last_error = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [row.id, nextAttemptAt?.toISOString() ?? null, error]
  );
};

export const processQueuedEmailMessages = async (
  pool: Pool | null,
  options: EmailQueueProcessOptions = {}
): Promise<EmailQueueProcessResult> => {
  if (!pool) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      messageIds: [],
      sentMessageIds: [],
      failedMessageIds: []
    };
  }

  const rows = await claimQueuedEmailMessages(pool, {
    limit: options.limit ?? 10,
    messageIds: options.messageIds
  });
  const sentMessageIds: string[] = [];
  const failedMessageIds: string[] = [];

  for (const row of rows) {
    const result = await sendEmailPayload({
      to: row.recipient_email,
      from: row.from_email,
      replyTo: row.reply_to_email,
      subject: row.subject,
      text: row.text_body,
      html: row.html_body
    });

    if (result.sent) {
      await markEmailSent(pool, row.id);
      sentMessageIds.push(row.id);
    } else {
      await markEmailFailed(pool, row, result.error);
      failedMessageIds.push(row.id);
    }
  }

  return {
    attempted: rows.length,
    sent: sentMessageIds.length,
    failed: failedMessageIds.length,
    messageIds: rows.map((row) => row.id),
    sentMessageIds,
    failedMessageIds
  };
};

export const retryAdminEmailQueueMessage = async (
  pool: Pool | null,
  messageId: string
): Promise<EmailQueueProcessResult> => {
  if (!pool || !(await hasEmailMessagesTable(pool))) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      messageIds: [],
      sentMessageIds: [],
      failedMessageIds: []
    };
  }

  await pool.query(
    `
      UPDATE email_messages
      SET
        status = 'queued',
        attempts = CASE
          WHEN attempts >= max_attempts THEN GREATEST(max_attempts - 1, 0)
          ELSE attempts
        END,
        next_attempt_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
        AND status IN ('queued', 'sending', 'failed')
    `,
    [messageId]
  );

  return processQueuedEmailMessages(pool, {
    limit: 1,
    messageIds: [messageId]
  });
};

const queueAndProcessEmail = async (
  pool: Pool | null,
  input: QueueEmailInput
): Promise<EmailQueueResult> => {
  const queued = await enqueueEmailMessage(pool, input);
  if (!queued.messageId || queued.error) {
    return {
      queued: queued.queued,
      duplicate: queued.duplicate,
      messageId: queued.messageId,
      attempted: false,
      sent: false,
      error: queued.error
    };
  }

  if (queued.status === 'sent') {
    return {
      queued: false,
      duplicate: queued.duplicate,
      messageId: queued.messageId,
      attempted: false,
      sent: true,
      error: null
    };
  }

  const processed = await processQueuedEmailMessages(pool, {
    limit: 1,
    messageIds: [queued.messageId]
  });
  const sent = processed.sentMessageIds.includes(queued.messageId);

  return {
    queued: true,
    duplicate: queued.duplicate,
    messageId: queued.messageId,
    attempted: processed.messageIds.includes(queued.messageId),
    sent,
    error:
      !sent && processed.failedMessageIds.includes(queued.messageId)
        ? 'Email delivery failed and will be retried.'
        : null
  };
};

export const sendSponsorshipFollowupEmail = async (
  input: SponsorshipFollowupEmailInput
): Promise<EmailSendResult> => {
  const rendered = renderSponsorshipFollowupEmail(input);
  return sendEmailPayload({
    to: input.to,
    from: emailFrom,
    replyTo: emailReplyTo || null,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html
  });
};

export const queueSponsorshipFollowupEmail = async (
  pool: Pool | null,
  input: SponsorshipFollowupEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipFollowupEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

export const queueSponsorshipConfirmationEmail = async (
  pool: Pool | null,
  input: SponsorshipConfirmationEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipConfirmationEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

export const queueSponsorshipRejectionEmail = async (
  pool: Pool | null,
  input: SponsorshipRejectionEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipRejectionEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

export const queueSponsorshipRefundEmail = async (
  pool: Pool | null,
  input: SponsorshipRefundEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipRefundEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

export const queueSponsorshipInvoiceEmail = async (
  pool: Pool | null,
  input: SponsorshipInvoiceEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipInvoiceEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

export const queueSponsorshipCreditNoteEmail = async (
  pool: Pool | null,
  input: SponsorshipCreditNoteEmailInput
): Promise<EmailQueueResult> => {
  const rendered = renderSponsorshipCreditNoteEmail(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};

/**
 * Notifies the configured admin address when a publication batch reaches
 * capacity, so it gets scheduled or published instead of sitting full and
 * unnoticed. Purely informational: it never schedules or publishes anything
 * itself.
 */
export const queuePublicationBatchFullNotification = async (
  pool: Pool | null,
  input: PublicationBatchFullEmailInput
): Promise<EmailQueueResult> => {
  if (!adminNotificationEmail) {
    return {
      queued: false,
      duplicate: false,
      messageId: null,
      attempted: false,
      sent: false,
      error: 'Admin notification address is not configured.'
    };
  }

  const rendered = renderPublicationBatchFullNotification(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: adminNotificationEmail,
    idempotencyKey: input.idempotencyKey
  });
};

export const queueEmailConfigurationTest = async (
  pool: Pool | null,
  input: EmailConfigurationTestInput
): Promise<EmailQueueResult> => {
  const rendered = renderEmailConfigurationTest(input);
  return queueAndProcessEmail(pool, {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey
  });
};
