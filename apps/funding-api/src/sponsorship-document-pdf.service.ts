import PDFDocument from 'pdfkit';

import type {
  SponsorshipCreditNoteRecord,
  SponsorshipInvoiceLineItem,
  SponsorshipInvoiceRecord
} from './sponsorship-invoices.repository.js';

type PdfDocument = InstanceType<typeof PDFDocument>;

const brandColor = '#172033';
const mutedColor = '#5f6f90';
const accentColor = '#b98224';
const ruleColor = '#d8d0c4';

const safeFilenamePart = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');

export const sponsorshipInvoicePdfFilename = (
  invoice: SponsorshipInvoiceRecord
): string => `openg7-${safeFilenamePart(invoice.invoiceNumber)}.pdf`;

export const sponsorshipCreditNotePdfFilename = (
  creditNote: SponsorshipCreditNoteRecord
): string => `openg7-${safeFilenamePart(creditNote.creditNoteNumber)}.pdf`;

const collectPdf = (build: (document: PdfDocument) => void): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const document = new PDFDocument({
      autoFirstPage: true,
      margin: 48,
      size: 'LETTER'
    });
    const chunks: Buffer[] = [];

    document.on('data', (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });
    document.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    document.on('error', reject);

    build(document);
    document.end();
  });

const formatMoney = (amountCents: number, currency: string): string => {
  const amount = Number((amountCents / 100).toFixed(2));
  const formatted = new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);

  return `${currency.toUpperCase()} ${formatted}`;
};

const formatDate = (value: string | null): string => {
  if (!value) {
    return 'Non disponible';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'long'
  }).format(date);
};

const valueOrFallback = (
  value: string | null | undefined,
  fallback = 'Non fourni'
): string => {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : fallback;
};

const contentWidth = (document: PdfDocument): number =>
  document.page.width -
  document.page.margins.left -
  document.page.margins.right;

const contentRight = (document: PdfDocument): number =>
  document.page.width - document.page.margins.right;

const ensureSpace = (document: PdfDocument, height: number): void => {
  if (
    document.y + height <=
    document.page.height - document.page.margins.bottom
  ) {
    return;
  }

  document.addPage();
};

const addRule = (document: PdfDocument): void => {
  document
    .moveTo(document.page.margins.left, document.y)
    .lineTo(contentRight(document), document.y)
    .strokeColor(ruleColor)
    .lineWidth(1)
    .stroke();
  document.moveDown(0.9);
};

const addHeader = (
  document: PdfDocument,
  title: string,
  documentNumber: string,
  subtitle: string
): void => {
  const left = document.page.margins.left;
  const width = contentWidth(document);

  document.fillColor(brandColor).font('Helvetica-Bold').fontSize(14);
  document.text('OpenG7', left, document.y, { continued: false });

  const titleTop = document.y + 12;
  document
    .font('Helvetica-Bold')
    .fontSize(24)
    .fillColor(brandColor)
    .text(title, left, titleTop, { width: width * 0.62 });
  document
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(accentColor)
    .text(documentNumber, left + width * 0.62, titleTop + 4, {
      align: 'right',
      width: width * 0.38
    });
  document
    .font('Helvetica')
    .fontSize(10)
    .fillColor(mutedColor)
    .text(subtitle, left, document.y + 6, { width });
  document.moveDown(1.2);
  addRule(document);
};

const addKeyValue = (
  document: PdfDocument,
  label: string,
  value: string,
  x: number,
  width: number
): void => {
  document
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(mutedColor)
    .text(label.toUpperCase(), x, document.y, { width });
  document
    .font('Helvetica')
    .fontSize(10)
    .fillColor(brandColor)
    .text(value, x, document.y + 2, { width });
  document.moveDown(0.55);
};

const addTwoColumnSection = (
  document: PdfDocument,
  leftTitle: string,
  leftRows: readonly [string, string][],
  rightTitle: string,
  rightRows: readonly [string, string][]
): void => {
  ensureSpace(document, 148);

  const startY = document.y;
  const left = document.page.margins.left;
  const gap = 22;
  const columnWidth = (contentWidth(document) - gap) / 2;
  const right = left + columnWidth + gap;

  document
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(brandColor)
    .text(leftTitle, left, startY, { width: columnWidth });
  document
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(brandColor)
    .text(rightTitle, right, startY, { width: columnWidth });

  document.y = startY + 22;
  for (const [label, value] of leftRows) {
    addKeyValue(document, label, value, left, columnWidth);
  }
  const leftEndY = document.y;

  document.y = startY + 22;
  for (const [label, value] of rightRows) {
    addKeyValue(document, label, value, right, columnWidth);
  }
  document.y = Math.max(leftEndY, document.y);
  document.moveDown(0.8);
  addRule(document);
};

const addLineItems = (
  document: PdfDocument,
  lineItems: readonly SponsorshipInvoiceLineItem[],
  currency: string
): void => {
  ensureSpace(document, 120);

  const left = document.page.margins.left;
  const width = contentWidth(document);
  const quantityX = left + width * 0.58;
  const unitX = left + width * 0.7;
  const totalX = left + width * 0.84;

  document
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(brandColor)
    .text('Lignes', left, document.y);
  document.moveDown(0.6);

  document.font('Helvetica-Bold').fontSize(8).fillColor(mutedColor);
  document.text('DESCRIPTION', left, document.y, { width: width * 0.56 });
  document.text('QTE', quantityX, document.y, {
    align: 'right',
    width: width * 0.1
  });
  document.text('PRIX', unitX, document.y, {
    align: 'right',
    width: width * 0.12
  });
  document.text('TOTAL', totalX, document.y, {
    align: 'right',
    width: width * 0.16
  });
  document.moveDown(0.5);

  for (const item of lineItems) {
    ensureSpace(document, 42);

    const rowY = document.y;
    document
      .font('Helvetica')
      .fontSize(10)
      .fillColor(brandColor)
      .text(item.description, left, rowY, { width: width * 0.56 });
    document.text(String(item.quantity), quantityX, rowY, {
      align: 'right',
      width: width * 0.1
    });
    document.text(formatMoney(item.unitAmountCents, currency), unitX, rowY, {
      align: 'right',
      width: width * 0.12
    });
    document.text(formatMoney(item.totalCents, currency), totalX, rowY, {
      align: 'right',
      width: width * 0.16
    });
    document.y = Math.max(document.y, rowY + 26);
    document
      .moveTo(left, document.y)
      .lineTo(contentRight(document), document.y)
      .strokeColor('#ece6dc')
      .lineWidth(0.8)
      .stroke();
    document.moveDown(0.45);
  }
};

const addTotals = (
  document: PdfDocument,
  subtotalCents: number,
  taxCents: number,
  totalCents: number,
  taxLabel: string,
  currency: string,
  totalLabel: string
): void => {
  const width = contentWidth(document);
  const x = document.page.margins.left + width * 0.58;
  const labelWidth = width * 0.24;
  const valueWidth = width * 0.18;

  document.moveDown(0.4);

  for (const [label, value, bold] of [
    ['Sous-total', formatMoney(subtotalCents, currency), false],
    [taxLabel, formatMoney(taxCents, currency), false],
    [totalLabel, formatMoney(totalCents, currency), true]
  ] as const) {
    ensureSpace(document, 24);
    const rowY = document.y;
    document
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 12 : 10)
      .fillColor(bold ? brandColor : mutedColor)
      .text(label, x, rowY, { width: labelWidth });
    document
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 12 : 10)
      .fillColor(brandColor)
      .text(value, x + labelWidth, rowY, {
        align: 'right',
        width: valueWidth
      });
    document.y = rowY + (bold ? 24 : 20);
  }

  document.moveDown(0.5);
  addRule(document);
};

const addReferences = (
  document: PdfDocument,
  rows: readonly [string, string][]
): void => {
  ensureSpace(document, 90);

  const left = document.page.margins.left;
  const labelWidth = 132;
  const valueWidth = contentWidth(document) - labelWidth;

  document
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(brandColor)
    .text('References', left, document.y);
  document.moveDown(0.6);

  for (const [label, value] of rows) {
    const rowY = document.y;
    document
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(mutedColor)
      .text(label.toUpperCase(), left, rowY, { width: labelWidth });
    document
      .font('Helvetica')
      .fontSize(9)
      .fillColor(brandColor)
      .text(value, left + labelWidth, rowY, { width: valueWidth });
    document.y = rowY + 18;
  }

  document.moveDown(0.7);
};

const addNote = (
  document: PdfDocument,
  title: string,
  note: string | null
): void => {
  if (!note) {
    return;
  }

  ensureSpace(document, 72);
  document
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(brandColor)
    .text(title);
  document.moveDown(0.25);
  document
    .font('Helvetica')
    .fontSize(9)
    .fillColor(mutedColor)
    .text(note, {
      width: contentWidth(document)
    });
};

export const renderSponsorshipInvoicePdf = (
  invoice: SponsorshipInvoiceRecord
): Promise<Buffer> =>
  collectPdf((document) => {
    document.info.Title = `Facture ${invoice.invoiceNumber}`;
    document.info.Author = 'OpenG7';

    addHeader(
      document,
      'Facture de commandite',
      invoice.invoiceNumber,
      'Fonds des batisseurs OpenG7'
    );
    addTwoColumnSection(
      document,
      'Emetteur',
      [
        ['Nom', invoice.issuerName],
        ['Courriel', valueOrFallback(invoice.issuerEmail)],
        ['Adresse', valueOrFallback(invoice.issuerAddress)],
        ['Identifiant fiscal', valueOrFallback(invoice.issuerTaxId)]
      ],
      'Commanditaire',
      [
        ['Nom', invoice.sponsorName],
        ['Contact', valueOrFallback(invoice.sponsorContactName)],
        ['Courriel', valueOrFallback(invoice.sponsorContactEmail)],
        ['Site web', valueOrFallback(invoice.sponsorWebsiteUrl)]
      ]
    );
    addTwoColumnSection(
      document,
      'Document',
      [
        ['Numero', invoice.invoiceNumber],
        ['Reference publique', valueOrFallback(invoice.publicReference)],
        ['Date emission', formatDate(invoice.issuedAtIso)]
      ],
      'Paiement',
      [
        ['Date paiement', formatDate(invoice.paidAtIso)],
        ['Devise', invoice.currency.toUpperCase()],
        ['Statut', 'Paye']
      ]
    );
    addLineItems(document, invoice.lineItems, invoice.currency);
    addTotals(
      document,
      invoice.subtotalCents,
      invoice.taxCents,
      invoice.totalCents,
      invoice.taxLabel,
      invoice.currency,
      'Total paye'
    );
    addReferences(document, [
      ['Stripe Session', invoice.stripeSessionId],
      [
        'Payment Intent',
        valueOrFallback(invoice.stripePaymentIntentId, 'Absent')
      ]
    ]);
    addNote(document, 'Note', invoice.notes);
  });

export const renderSponsorshipCreditNotePdf = (
  creditNote: SponsorshipCreditNoteRecord
): Promise<Buffer> =>
  collectPdf((document) => {
    document.info.Title = `Avoir ${creditNote.creditNoteNumber}`;
    document.info.Author = 'OpenG7';

    addHeader(
      document,
      'Avoir de commandite',
      creditNote.creditNoteNumber,
      'Remboursement documente apres operation Stripe'
    );
    addTwoColumnSection(
      document,
      'Emetteur',
      [
        ['Nom', creditNote.issuerName],
        ['Courriel', valueOrFallback(creditNote.issuerEmail)],
        ['Adresse', valueOrFallback(creditNote.issuerAddress)],
        ['Identifiant fiscal', valueOrFallback(creditNote.issuerTaxId)]
      ],
      'Commanditaire',
      [
        ['Nom', creditNote.sponsorName],
        ['Contact', valueOrFallback(creditNote.sponsorContactName)],
        ['Courriel', valueOrFallback(creditNote.sponsorContactEmail)],
        ['Site web', valueOrFallback(creditNote.sponsorWebsiteUrl)]
      ]
    );
    addTwoColumnSection(
      document,
      'Avoir',
      [
        ['Numero', creditNote.creditNoteNumber],
        ['Facture associee', creditNote.invoiceNumber],
        ['Date emission', formatDate(creditNote.issuedAtIso)]
      ],
      'Remboursement',
      [
        ['Stripe Refund', creditNote.stripeRefundId],
        [
          'Payment Intent',
          valueOrFallback(creditNote.stripePaymentIntentId, 'Absent')
        ],
        ['Reference publique', valueOrFallback(creditNote.publicReference)]
      ]
    );
    addLineItems(document, creditNote.lineItems, creditNote.currency);
    addTotals(
      document,
      creditNote.subtotalCents,
      creditNote.taxCents,
      creditNote.totalCents,
      creditNote.taxLabel,
      creditNote.currency,
      'Total credite'
    );
    addReferences(document, [
      ['Facture associee', creditNote.invoiceNumber],
      ['Stripe Refund', creditNote.stripeRefundId],
      [
        'Payment Intent',
        valueOrFallback(creditNote.stripePaymentIntentId, 'Absent')
      ]
    ]);
    addNote(document, 'Note', creditNote.notes);
  });
