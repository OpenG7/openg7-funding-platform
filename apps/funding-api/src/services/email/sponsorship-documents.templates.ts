import {
  centsToAmount,
  escapeHtml,
  formatDate,
  formatMoney
} from './email-rendering.js';
import type {
  RenderedEmail,
  SponsorshipCreditNoteEmailInput,
  SponsorshipInvoiceEmailInput
} from './email-notification.types.js';

const optionalText = (
  label: string,
  value: string | null | undefined
): readonly string[] => (value?.trim() ? [`${label}: ${value.trim()}`] : []);

export const renderSponsorshipInvoiceEmail = (
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
      ).replaceAll('\n', '<br />')}
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

export const renderSponsorshipCreditNoteEmail = (
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
